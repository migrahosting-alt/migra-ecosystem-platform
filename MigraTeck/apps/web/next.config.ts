import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@migrateck/auth-client", "@migrateck/lib", "@migrateck/ui"],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
