import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CLIENT_IP_HEADER, clientIp, viaEdge } from "../../common/client-ip";
import { timingSummary } from "../../common/timing";
import { env } from "../../config/env";
import { AdminGuard } from "./catalog";

/**
 * What the API sees of the caller's address — to check a deployment's proxy chain (Vercel → Render) without
 * guessing. Admins only; it echoes the caller's own request, nothing else.
 */
@Controller("admin/diagnostics")
@UseGuards(AdminGuard)
export class DiagnosticsController {
  @Get("request")
  request(@Req() req: Request) {
    return {
      /** What rate limits key on. */
      clientIp: clientIp(req),
      /** True when the request came through the web proxy with the shared secret. */
      viaEdge: viaEdge(req),
      edgeSecretConfigured: !!env.EDGE_SECRET,
      forwardedClientIp:
        typeof req.headers[CLIENT_IP_HEADER] === "string"
          ? req.headers[CLIENT_IP_HEADER]
          : null,
      /** Express's view with TRUST_PROXY applied. */
      reqIp: req.ip ?? null,
      reqIps: req.ips,
      trustProxy: env.TRUST_PROXY,
      xForwardedFor: req.headers["x-forwarded-for"] ?? null,
      remoteAddress: req.socket.remoteAddress ?? null,
    };
  }

  /** Recent server-side durations per route (since this instance started): p50 / p95 / max, average DB time and query count. */
  @Get("timings")
  timings() {
    return timingSummary();
  }
}
