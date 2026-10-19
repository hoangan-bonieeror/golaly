import { NextResponse, type NextRequest } from "next/server";

/**
 * API calls go through this app's rewrite to the API host, so the API sees this server's address, not the
 * browser's — every visitor would share one rate-limit bucket. For /api/v1/* this proxy forwards the browser's
 * address (as the platform reports it: Vercel sets x-real-ip / x-forwarded-for and overwrites what clients send)
 * together with the shared EDGE_SECRET; the API trusts the address only when the secret matches.
 * Whatever a client sent in these headers itself is always removed.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("x-golaly-edge");
  headers.delete("x-golaly-client-ip");
  const secret = process.env.EDGE_SECRET;
  const ip = (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    ""
  ).trim();
  if (secret && ip) {
    headers.set("x-golaly-client-ip", ip);
    headers.set("x-golaly-edge", secret);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/v1/:path*",
};
