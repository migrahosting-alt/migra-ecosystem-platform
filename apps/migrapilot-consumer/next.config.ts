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
