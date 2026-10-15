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
/**
 * Where /media/* comes from. Unset: the API (MEDIA_DRIVER=local). With the API on MEDIA_DRIVER=s3, set it to the
 * bucket's public URL (same value as the API's MEDIA_PUBLIC_URL) so images skip the API hop; the API would
 * otherwise redirect there itself. Images stay on this origin, so the offline service worker can cache them.
 */
const MEDIA_ORIGIN = (process.env.MEDIA_ORIGIN ?? "").replace(/\/+$/, "");

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
  // Dev only: hostnames other than localhost that may load the dev server (a phone on the LAN, an
  // HTTPS tunnel). Set by `node scripts/dev-phone.mjs`; comma-separated, e.g. "192.168.1.23,*.trycloudflare.com".
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  poweredByHeader: false,
  // Docker builds a self-contained server bundle (only the files it needs, no devDependencies).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The offline service worker must never be served stale (a new deploy replaces it).
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${API_ORIGIN}/api/v1/:path*` },
      { source: "/media/:path*", destination: MEDIA_ORIGIN ? `${MEDIA_ORIGIN}/:path*` : `${API_ORIGIN}/media/:path*` },
    ];
  },
};

export default nextConfig;
