import type { NextConfig } from "next";
import path from "node:path";

/**
 * The browser only ever talks to this origin: /api/v1/* and /media/* are proxied to the
 * NestJS API, so auth cookies are first-party and no CORS is needed for REST calls.
 * Realtime (Socket.IO) connects to the API directly — see NEXT_PUBLIC_REALTIME_URL — or, in
 * Docker, through the same origin via the nginx edge (deploy/nginx.conf).
 *
 * Client IPs: src/proxy.ts hands the API each visitor's address with the shared EDGE_SECRET
 * (see docs/ARCHITECTURE.md → client IP).
 */
const API_ORIGIN = process.env.API_ORIGIN || "http://localhost:4000";
// A Vercel build without API_ORIGIN would ship a site whose /api/v1 rewrites go nowhere (every call a 404):
// fail the build instead.
if (process.env.VERCEL && !process.env.API_ORIGIN) throw new Error("API_ORIGIN must be set for a Vercel build (the API's https URL).");
/**
 * Where /media/* comes from. Unset: the API (MEDIA_DRIVER=local). With the API on MEDIA_DRIVER=s3, set it to the
 * bucket's public URL (same value as the API's MEDIA_PUBLIC_URL) so images skip the API hop; the API would
 * otherwise redirect there itself. Images stay on this origin, so the offline service worker can cache them.
 */
const MEDIA_ORIGIN = (process.env.MEDIA_ORIGIN ?? "").replace(/\/+$/, "");

const DEV = process.env.NODE_ENV !== "production";
const originOf = (url: string | undefined) => {
  try {
    return url && /^https?:/.test(url) ? new URL(url).origin : null;
  } catch {
    return null;
  }
};
/** http(s)://host → also ws(s)://host (the realtime socket upgrades on the same host). */
const withSocket = (origin: string | null) => (origin ? [origin, origin.replace(/^http/, "ws")] : []);

/**
 * Content Security Policy (security review S21) — a second line of defence if a script ever gets injected: it can't
 * send data anywhere but our own origin, the realtime API and the map tiles, can't load scripts or frames from
 * elsewhere, and can't be framed. Scripts stay 'unsafe-inline' for now (Next's inline bootstrap and the theme script;
 * moving to nonces means rendering every page dynamically). Development is looser: the dev socket host is dynamic
 * (dev-phone, tunnels) and React refresh needs eval.
 */
const CONNECT = DEV
  ? ["'self'", "http:", "https:", "ws:", "wss:"]
  : [
      "'self'",
      ...withSocket(originOf(process.env.NEXT_PUBLIC_REALTIME_URL)),
      originOf(process.env.NEXT_PUBLIC_MAP_STYLE_URL) ?? "https://tiles.openfreemap.org",
      ...[originOf(process.env.NEXT_PUBLIC_MAP_STYLE_URL_DARK)],
      // Extra hosts a custom map style loads tiles or glyphs from (space-separated origins).
      ...(process.env.CSP_CONNECT_EXTRA ?? "").split(/\s+/),
    ];
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${[...new Set(CONNECT.filter(Boolean))].join(" ")}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Baseline hardening for every page. `frame-ancestors 'none'` + X-Frame-Options stop clickjacking. */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Geolocation only for our own pages (Explore → "Near me"); never for embedded third parties.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@golaly/shared", "@golaly/client", "@golaly/tokens"],
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
