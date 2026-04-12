import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@migrateck/lib", "@migrateck/ui"],
  turbopack: {
    root: path.join(appRoot, "../.."),
  },
};

export default nextConfig;
