import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@migrateck/lib", "@migrateck/ui"],
};

export default nextConfig;
