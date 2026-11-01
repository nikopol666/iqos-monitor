import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is what the Docker image runs (node server.js).
  output: "standalone",
  // This is a LAN dashboard with live data: every page is rendered per request,
  // so the Cache Components model brings nothing here and would force Suspense
  // boundaries around every database read.
  cacheComponents: false,
  // Dev server only: a phone on the LAN loads the page by this machine's IP,
  // and Next.js refuses to serve /_next/* to origins it does not know (403,
  // no JavaScript at all). List your LAN address in DEV_ORIGINS="ip1,ip2"
  // (server/.env.local works). Production (Docker) is unaffected.
  allowedDevOrigins: ["localhost", "127.0.0.1", ...(process.env.DEV_ORIGINS ? process.env.DEV_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) : [])],
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
