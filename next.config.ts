import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const distDir = process.env.HACKRF_WEBUI_NEXT_DIST_DIR?.trim();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: ROOT_DIR,
  },
};

export default nextConfig;
