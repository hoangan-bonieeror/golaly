/**
 * MEDIA_DRIVER=s3 end to end against a tiny in-process S3 stand-in that checks every request's
 * Signature V4 the way R2/S3 would: uploads land in the bucket, /media/* redirects to the public URL,
 * deleting a photo deletes its objects.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import type { MediaView } from "@golaly/shared";
import { signV4 } from "../src/modules/media/s3";
import type { TestContext } from "./helpers";

const BUCKET = "golaly-media";
const PUBLIC = "https://pub-test.r2.dev";
const objects = new Map<string, { body: Buffer; type: string; cache: string }>();
const rejected: string[] = [];
let server: Server;
let t: TestContext;
const S3_VARS = ["MEDIA_DRIVER", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "MEDIA_PUBLIC_URL"];
// --runInBand shares process.env between test files: put it back afterwards.
const saved = Object.fromEntries(S3_VARS.map((k) => [k, process.env[k]]));

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const signed = Object.fromEntries(
      ["x-amz-date", "x-amz-content-sha256", "content-type", "cache-control"].filter((h) => req.headers[h]).map((h) => [h, String(req.headers[h])]),
    );
    const expected = signV4({ method: req.method!, url, headers: signed, accessKeyId: "test-key", secretAccessKey: "test-secret", region: "auto" });
    if (req.headers.authorization !== expected) {
      rejected.push(`${req.method} ${url.pathname}`);
      return res.writeHead(403).end("SignatureDoesNotMatch");
    }
    const prefix = `/${BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return res.writeHead(404).end();
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    if (req.method === "PUT") {
      objects.set(key, { body, type: String(req.headers["content-type"]), cache: String(req.headers["cache-control"]) });
      return res.writeHead(200).end();
    }
    if (req.method === "HEAD") return res.writeHead(objects.has(key) ? 200 : 404).end();
    if (req.method === "DELETE") {
      objects.delete(key);
      return res.writeHead(204).end();
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  Object.assign(process.env, {
    MEDIA_DRIVER: "s3",
    S3_ENDPOINT: `http://127.0.0.1:${port}`,
    S3_REGION: "auto",
    S3_BUCKET: BUCKET,
    S3_ACCESS_KEY_ID: "test-key",
    S3_SECRET_ACCESS_KEY: "test-secret",
    MEDIA_PUBLIC_URL: `${PUBLIC}/`,
  });
  // Loaded only now, so config/env.ts reads the variables above.
  const { createTestContext } = await import("./helpers");
  t = await createTestContext();
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await t?.app.close();
  await new Promise((r) => server.close(r));
});

describe("MEDIA_DRIVER=s3", () => {
  it("stores all three sizes in the bucket, redirects /media/*, and deletes them with the photo", async () => {
    const u = await t.register("bucket", { verified: true });
    const jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#1f5e52" } }).jpeg().toBuffer();
    const up = await u.raw.post("/api/v1/media").set("X-Requested-With", "golaly").attach("file", jpeg, { filename: "p.jpg", contentType: "image/jpeg" });
    expect(up.status).toBe(201);
    const media = up.body as MediaView;

    const row = await t.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    const keys = [row.storageKey, row.mediumKey!, row.thumbKey!];
    for (const k of keys) {
      expect(objects.get(k)).toMatchObject({ type: "image/webp", cache: "public, max-age=31536000, immutable" });
      expect((await sharp(objects.get(k)!.body).metadata()).format).toBe("webp");
    }
    expect(media.fullUrl).toBe(`/media/${row.storageKey}`); // URLs stay on the app's origin

    const r = await t.anon().raw.get(`/media/${row.thumbKey}`);
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe(`${PUBLIC}/${row.thumbKey}`);

    expect((await u.delete(`/media/${media.id}`)).status).toBe(200);
    for (const k of keys) expect(objects.has(k)).toBe(false);
    expect(rejected).toEqual([]);
  });
});
