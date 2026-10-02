import type { NextConfig } from "next";

/**
 * The browser only ever talks to this origin: /api/v1/* and /media/* are proxied to the
 * NestJS API, so auth cookies are first-party and no CORS is needed for REST calls.
 * Realtime (Socket.IO) connects to the API directly — see NEXT_PUBLIC_REALTIME_URL.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@triply/shared"],
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${API_ORIGIN}/api/v1/:path*` },
      { source: "/media/:path*", destination: `${API_ORIGIN}/media/:path*` },
    ];
  },
};

export default nextConfig;
