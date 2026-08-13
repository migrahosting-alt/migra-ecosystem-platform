/**
 * Server composition root.
 *
 * Next calls `register()` once per server process, before any request is
 * handled, and never in the browser. This is where the canonical MigraAuth
 * implementation is installed into the application's auth port.
 *
 * Variable names and scopes deliberately match the canonical reference
 * implementation at `MigraTeck/apps/web/src/lib/auth/init.ts`, so operations
 * configures this app the same way it configures every other MigraAuth client.
 *
 * If the MigraAuth environment is not fully configured the port is left at its
 * fail-closed default: the app then serves no principal at all rather than a
 * fabricated one, and every Brain call returns `unauthenticated`.
 */

/**
 * `clientSecret` is intentionally absent from this list. The issuer advertises
 * `token_endpoint_auth_methods_supported: ["none", "client_secret_post"]`, so a
 * public PKCE client is valid; the secret is supplied only when the consumer is
 * registered as a confidential client.
 */
const REQUIRED = [
  'MIGRAAUTH_CLIENT_ID',
  'MIGRAAUTH_REDIRECT_URI',
  'APP_BASE_URL',
  'APP_SESSION_SECRET',
] as const

/** Matches the issuer's `scopes_supported`; `orgs:read` is how org context arrives pre-#147. */
const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'orgs:read']

const trimSlashes = (url: string) => url.replace(/\/+$/, '')

export async function register(): Promise<void> {
  // Edge runtime has no MigraAuth session; only wire the Node.js server.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const missing = REQUIRED.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) {
    console.warn(
      `[auth] MigraAuth not configured (missing: ${missing.join(', ')}). ` +
        'Running fail-closed — no principal will be issued.',
    )
    return
  }

  const { initAuthClient } = await import('@migrateck/auth-client')
  const { setAuthPort } = await import('@/server/auth')
  const { migraAuthPort } = await import('@/server/auth/migraAuthPort')

  const appBaseUrl = trimSlashes(process.env.APP_BASE_URL!)
  const migraAuthBaseUrl = trimSlashes(
    process.env.MIGRAAUTH_BASE_URL ?? process.env.AUTH_PUBLIC_URL ?? 'http://localhost:4000',
  )
  const migraAuthWebUrl = trimSlashes(
    process.env.MIGRAAUTH_WEB_URL ?? process.env.AUTH_WEB_URL ?? 'http://localhost:4100',
  )

  initAuthClient({
    migraAuthBaseUrl,
    migraAuthWebUrl,
    clientId: process.env.MIGRAAUTH_CLIENT_ID!,
    ...(process.env.MIGRAAUTH_CLIENT_SECRET
      ? { clientSecret: process.env.MIGRAAUTH_CLIENT_SECRET }
      : {}),
    redirectUri: trimSlashes(process.env.MIGRAAUTH_REDIRECT_URI!),
    postLogoutRedirectUri: trimSlashes(
      process.env.MIGRAAUTH_POST_LOGOUT_REDIRECT_URI ?? appBaseUrl,
    ),
    appBaseUrl,
    scopes: (process.env.MIGRAAUTH_SCOPES?.split(/\s+/).filter(Boolean).length
      ? process.env.MIGRAAUTH_SCOPES!.split(/\s+/).filter(Boolean)
      : DEFAULT_SCOPES),
    sessionCookieName: process.env.APP_SESSION_COOKIE_NAME ?? 'migrapilot_consumer_session',
    sessionSecret: process.env.APP_SESSION_SECRET!,
  })

  setAuthPort(migraAuthPort)
}
