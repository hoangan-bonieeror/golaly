import { Logger } from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";
import type { StorageDriver } from "./media";

/**
 * S3-compatible object storage (Cloudflare R2, Backblaze B2, MinIO, AWS S3) without the AWS SDK:
 * the API only ever PUTs, HEADs and DELETEs whole objects, so a small Signature V4 signer is enough.
 *
 * Path-style URLs (`<endpoint>/<bucket>/<key>`) work on every provider above. Objects are written
 * with an immutable cache header — keys are random and never overwritten.
 */
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as Signature V4 requires (encodeURIComponent leaves !'()* alone). */
export const encodeRfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** `20130524T000000Z` */
export const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign (besides host). Must include x-amz-date and x-amz-content-sha256. */
  headers: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

/**
 * AWS Signature Version 4 (header form). Returns the Authorization header value.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */
export function signV4({ method, url, headers, accessKeyId, secretAccessKey, region, service = "s3" }: SignInput) {
  const all: Record<string, string> = { host: url.host };
  for (const [k, v] of Object.entries(headers)) all[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const payloadHash = all["x-amz-content-sha256"];
  const stamp = all["x-amz-date"];
  if (!payloadHash || !stamp) throw new Error("signV4 needs x-amz-date and x-amz-content-sha256 headers");
  // S3 paths are signed as sent: already encoded once by buildUrl(), never re-encoded.
  const canonicalRequest = [method, url.pathname, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const day = stamp.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

const CONTENT_TYPES: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
export const contentTypeFor = (key: string) => CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export class S3StorageDriver implements StorageDriver {
  private readonly log = new Logger("S3Storage");

  constructor(
    private readonly cfg: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** `<endpoint>/<bucket>/<key>` with every key segment encoded once. */
  buildUrl(key: string) {
    if (!key || key.startsWith("/") || key.split("/").some((s) => s === "" || s === "." || s === "..")) throw new Error("bad key");
    const base = this.cfg.endpoint.replace(/\/+$/, "");
    return new URL(`${base}/${encodeRfc3986(this.cfg.bucket)}/${key.split("/").map(encodeRfc3986).join("/")}`);
  }

  private async send(method: "PUT" | "HEAD" | "DELETE", key: string, body?: Buffer, extra: Record<string, string> = {}) {
    const url = this.buildUrl(key);
    const headers: Record<string, string> = {
      ...extra,
      "x-amz-content-sha256": body ? sha256(body) : EMPTY_SHA256,
      "x-amz-date": amzDate(this.now()),
    };
    headers.authorization = signV4({ method, url, headers, accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey, region: this.cfg.region });
    return this.fetchImpl(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
  }

  async put(key: string, body: Buffer) {
    const extra = { "content-type": contentTypeFor(key), "cache-control": "public, max-age=31536000, immutable" };
    let res = await this.send("PUT", key, body, extra).catch(() => null);
    // One retry: object stores occasionally answer 5xx / drop a connection under load.
    if (!res || res.status >= 500) res = await this.send("PUT", key, body, extra);
    if (!res.ok) throw new Error(`Object storage refused PUT ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  async exists(key: string) {
    const res = await this.send("HEAD", key);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`Object storage refused HEAD ${key}: HTTP ${res.status}`);
    return true;
  }

  /** Best effort, like the local driver: the database row is already gone, a stray object only costs storage. */
  async delete(key: string) {
    try {
      const res = await this.send("DELETE", key);
      if (!res.ok && res.status !== 404) this.log.warn(`DELETE ${key}: HTTP ${res.status}`);
    } catch (e) {
      this.log.warn(`DELETE ${key}: ${(e as Error).message}`);
    }
  }
}
