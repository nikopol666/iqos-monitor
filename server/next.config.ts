import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is what the Docker image runs (node server.js).
  output: "standalone",
  // This is a LAN dashboard with live data: every page is rendered per request,
  // so the Cache Components model brings nothing here and would force Suspense
  // boundaries around every database read.
  cacheComponents: false,
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
