import type { NextConfig } from 'next'

/**
 * The consumer app is the trust boundary between the browser and the Brain.
 *
 * Nothing here may expose a Brain base URL or any secret to the client: every
 * Brain call runs in a server module (see src/server/brain/gateway.ts), and the
 * only environment variables the browser may ever see are `NEXT_PUBLIC_*` —
 * of which this application deliberately defines none.
 */
const nextConfig: NextConfig = {
  /*
   * Local browsers reach this dev server as a cross-origin host, and Next blocks
   * /_next assets for such origins by default — the HTML loads, every chunk
   * 403s, and the page silently never hydrates, so client components appear
   * simply not to exist. Dev-only: `next build` ignores this entirely.
   */
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
