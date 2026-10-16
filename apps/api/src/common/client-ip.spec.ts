import type { Request } from "express";
import { env } from "../config/env";
import { clientIp, viaEdge } from "./client-ip";

const SECRET = "edge-secret-for-tests-0123456789abcdef";
const req = (headers: Record<string, string>, ip = "10.0.0.1") =>
  ({ headers, ip }) as unknown as Request;

describe("clientIp (S2)", () => {
  const before = env.EDGE_SECRET;
  afterEach(() => ((env as { EDGE_SECRET?: string }).EDGE_SECRET = before));
  const setSecret = (v: string | undefined) =>
    ((env as { EDGE_SECRET?: string }).EDGE_SECRET = v);

  it("uses the forwarded client IP only when the web proxy proves itself", () => {
    setSecret(SECRET);
    expect(
      clientIp(
        req({ "x-triply-edge": SECRET, "x-triply-client-ip": "203.0.113.9" }),
      ),
    ).toBe("203.0.113.9");
    expect(viaEdge(req({ "x-triply-edge": SECRET }))).toBe(true);
  });

  it("ignores the header from anyone else", () => {
    setSecret(SECRET);
    expect(clientIp(req({ "x-triply-client-ip": "203.0.113.9" }))).toBe(
      "10.0.0.1",
    );
    expect(
      clientIp(
        req({ "x-triply-edge": "wrong", "x-triply-client-ip": "203.0.113.9" }),
      ),
    ).toBe("10.0.0.1");
    expect(
      clientIp(
        req({ "x-triply-edge": SECRET, "x-triply-client-ip": "not-an-ip" }),
      ),
    ).toBe("10.0.0.1");
  });

  it("does nothing when no secret is configured", () => {
    setSecret(undefined);
    expect(viaEdge(req({ "x-triply-edge": "" }))).toBe(false);
    expect(
      clientIp(
        req({ "x-triply-edge": "", "x-triply-client-ip": "203.0.113.9" }),
      ),
    ).toBe("10.0.0.1");
  });
});
