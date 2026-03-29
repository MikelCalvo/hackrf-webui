import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: ROOT_DIR,
  },
};

export default nextConfig;
