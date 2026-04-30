import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

const AUTH_WEB_URL =
  process.env.ACCOUNT_URL ??
  process.env.AUTH_WEB_URL ??
  "https://auth.migrateck.com";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@migrateck/auth-client", "@migrateck/lib", "@migrateck/ui"],
  turbopack: {
    root: repoRoot,
  },
  async redirects() {
    return [
      {
        source: "/forgot-password",
        destination: `${AUTH_WEB_URL}/forgot-password`,
        permanent: true,
      },
      {
        source: "/sessions",
        destination: `${AUTH_WEB_URL}/sessions`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
