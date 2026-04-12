const path = require("path");
const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const PILOT_API = process.env.PILOT_API_URL || "http://localhost:3377";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async rewrites() {
    return {
      // Fallback rewrites: only used when no matching Next.js API route exists
      fallback: [
        {
          source: "/api/:path*",
          destination: `${PILOT_API}/api/:path*`,
        },
        {
          source: "/health/:path*",
          destination: `${PILOT_API}/health/:path*`,
        },
        {
          source: "/health",
          destination: `${PILOT_API}/health`,
        },
      ],
    };
  },
};

module.exports = withNextIntl(nextConfig);
