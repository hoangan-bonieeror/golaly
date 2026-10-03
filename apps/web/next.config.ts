import type { NextConfig } from "next";
import path from "node:path";

/**
 * The browser only ever talks to this origin: /api/v1/* and /media/* are proxied to the
 * NestJS API, so auth cookies are first-party and no CORS is needed for REST calls.
 * Realtime (Socket.IO) connects to the API directly — see NEXT_PUBLIC_REALTIME_URL — or, in
 * Docker, through the same origin via the nginx edge (deploy/nginx.conf).
 *
 * Client IPs: Next passes X-Forwarded-For through untouched, so in production put an edge in
 * front that OVERWRITES it with the real client address (Vercel does; nginx: deploy/nginx.conf).
 * The API's per-IP rate limits rely on that; per-account login lockout does not.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

/** Baseline hardening for every page. `frame-ancestors 'none'` + X-Frame-Options stop clickjacking. */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Geolocation only for our own pages (Explore → "Near me"); never for embedded third parties.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@triply/shared"],
  poweredByHeader: false,
  // Docker builds a self-contained server bundle (only the files it needs, no devDependencies).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${API_ORIGIN}/api/v1/:path*` },
      { source: "/media/:path*", destination: `${API_ORIGIN}/media/:path*` },
    ];
  },
};

export default nextConfig;
