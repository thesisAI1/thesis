import type { NextConfig } from "next";

/**
 * Decoupled frontend. The browser only ever talks to the Next origin; these
 * rewrites proxy the API + SSE stream to the existing backend, so we need no
 * CORS headers and zero backend changes. Point THESIS_API_ORIGIN at the live
 * backend in production; defaults to the local mock-mode server on :4319.
 */
const API_ORIGIN = process.env.THESIS_API_ORIGIN ?? "http://localhost:4319";

const nextConfig: NextConfig = {
  // @thesis/shared exports raw .ts (./src/index.ts) — let Next compile it.
  transpilePackages: ["@thesis/shared"],
  async rewrites() {
    return [
      // Covers /api/dashboard, /api/status, /api/leaderboard, and /api/stream (SSE).
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
    ];
  },
};

export default nextConfig;
