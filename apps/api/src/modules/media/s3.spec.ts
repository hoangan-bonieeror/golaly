import { createHash } from "node:crypto";
import { amzDate, contentTypeFor, encodeRfc3986, S3StorageDriver, signV4 } from "./s3";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

describe("signV4", () => {
  // The worked example "GET Object" from the S3 Signature V4 documentation (header-based auth).
  it("reproduces AWS's published example signature", () => {
    const auth = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: {
        range: "bytes=0-9",
        "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "x-amz-date": "20130524T000000Z",
      },
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
    });
    expect(auth).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("refuses to sign without a date and payload hash", () => {
    expect(() => signV4({ method: "GET", url: new URL("https://x.test/a"), headers: {}, accessKeyId: "a", secretAccessKey: "b", region: "auto" })).toThrow();
  });

  it("formats dates and encodes like RFC 3986", () => {
    expect(amzDate(new Date("2026-10-15T05:23:50.123Z"))).toBe("20261015T052350Z");
    expect(encodeRfc3986("a b!'()*~é")).toBe("a%20b%21%27%28%29%2A~%C3%A9");
    expect(contentTypeFor("abc/x_thumb.webp")).toBe("image/webp");
    expect(contentTypeFor("x.JPG")).toBe("image/jpeg");
  });
});

describe("S3StorageDriver", () => {
  const cfg = { endpoint: "https://acct.r2.cloudflarestorage.com/", region: "auto", bucket: "triply-media", accessKeyId: "AK", secretAccessKey: "SK" };
  const now = () => new Date("2026-10-15T00:00:00Z");
  type Call = { url: string; method: string; headers: Record<string, string>; body?: Uint8Array };

  function fakeFetch(statuses: number[]) {
    const calls: Call[] = [];
    const fn = (async (input: URL, init: RequestInit) => {
      calls.push({ url: String(input), method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as Uint8Array | undefined });
      const status = statuses.shift() ?? 200;
      return new Response(status === 204 || status === 404 && init.method === "HEAD" ? null : "x", { status });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  it("PUTs path-style with a signed, immutable, typed request", async () => {
    const { fn, calls } = fakeFetch([200]);
    const body = Buffer.from("webp bytes");
    await new S3StorageDriver(cfg, fn, now).put("ab12cd34/tok en.webp", body);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.method).toBe("PUT");
    expect(c.url).toBe("https://acct.r2.cloudflarestorage.com/triply-media/ab12cd34/tok%20en.webp");
    expect(c.headers["content-type"]).toBe("image/webp");
    expect(c.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(c.headers["x-amz-content-sha256"]).toBe(sha(body));
    expect(c.headers["x-amz-date"]).toBe("20261015T000000Z");
    expect(Buffer.from(c.body!).toString()).toBe("webp bytes");
    // The server side recomputes the same signature from what it received.
    const { authorization, ...signed } = c.headers;
    expect(authorization).toBe(signV4({ method: "PUT", url: new URL(c.url), headers: signed, accessKeyId: "AK", secretAccessKey: "SK", region: "auto" }));
    expect(authorization).toContain("Credential=AK/20261015/auto/s3/aws4_request");
  });

  it("retries a 5xx once, then reports the failure", async () => {
    const ok = fakeFetch([503, 200]);
    await new S3StorageDriver(cfg, ok.fn, now).put("a/b.webp", Buffer.from("1"));
    expect(ok.calls).toHaveLength(2);
    const bad = fakeFetch([500, 403]);
    await expect(new S3StorageDriver(cfg, bad.fn, now).put("a/b.webp", Buffer.from("1"))).rejects.toThrow(/HTTP 403/);
  });

  it("HEAD tells whether an object exists; DELETE is best effort", async () => {
    const f = fakeFetch([200, 404, 500, 204]);
    const s3 = new S3StorageDriver(cfg, f.fn, now);
    expect(await s3.exists("a/b.webp")).toBe(true);
    expect(await s3.exists("a/c.webp")).toBe(false);
    await expect(s3.delete("a/b.webp")).resolves.toBeUndefined(); // 500 is only logged
    await expect(s3.delete("a/b.webp")).resolves.toBeUndefined();
    expect(f.calls.map((c) => c.method)).toEqual(["HEAD", "HEAD", "DELETE", "DELETE"]);
    expect(f.calls[0].headers["x-amz-content-sha256"]).toBe(sha(""));
  });

  it("rejects keys that could escape the bucket path", () => {
    const s3 = new S3StorageDriver(cfg, fakeFetch([]).fn, now);
    for (const k of ["", "/abs.webp", "a/../b.webp", "a//b.webp", "./a.webp"]) expect(() => s3.buildUrl(k)).toThrow("bad key");
  });
});
