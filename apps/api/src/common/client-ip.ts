import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { env } from "../config/env";

export const EDGE_HEADER = "x-golaly-edge";
export const CLIENT_IP_HEADER = "x-golaly-client-ip";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** True when the request came through our own web proxy (it carries the shared EDGE_SECRET). */
export function viaEdge(req: Pick<Request, "headers">): boolean {
  const secret = env.EDGE_SECRET;
  const sent = req.headers[EDGE_HEADER];
  if (!secret || typeof sent !== "string") return false;
  // Constant-time comparison of fixed-length digests.
  return timingSafeEqual(digest(sent), digest(secret));
}

/**
 * The browser's address, for rate limits and audit context. Requests through the web proxy carry it in
 * `x-golaly-client-ip` (trusted only with the shared secret); anything else — a direct call to the API host, a
 * spoofed header without the secret — falls back to the connection's address as Express sees it (TRUST_PROXY).
 */
export function clientIp(req: Pick<Request, "headers" | "ip">): string {
  if (viaEdge(req)) {
    const forwarded = req.headers[CLIENT_IP_HEADER];
    if (typeof forwarded === "string" && isIP(forwarded.trim()))
      return forwarded.trim();
  }
  return req.ip ?? "unknown";
}

/** The global rate limiter, keyed on the real client address (see clientIp). */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    return clientIp(req as unknown as Request);
  }
}
