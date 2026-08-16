import 'server-only'

import { unconfiguredAuthPort, type AuthPort } from './authPort'
import { absoluteHttpUrl, isProduction, readEnv, readFirstEnv } from './env'

/**
 * Resolve the auth implementation from the environment, in the runtime that is
 * actually serving the request.
 *
 * WHY THIS EXISTS. The port used to be installed once from `instrumentation.ts`
 * via `setAuthPort`. Next runs the instrumentation hook in its own module graph,
 * so the module-level variable that hook mutated was NOT the one route handlers
 * read: every route saw the fail-closed default and answered 503 even though the
 * environment was fully configured. Security-critical runtime configuration must
 * not depend on mutable singleton state being shared across bundles.
 *
 * Resolution is per-runtime and memoised by the caller. It stays FAIL-CLOSED:
 * anything missing or unusable yields `unconfiguredAuthPort`, which refuses
 * every operation rather than serving a fabricated principal.
 *
 * Every value below is read through `./env`, which treats an empty or
 * whitespace-only variable as absent. See that file for the production failure
 * that made this non-negotiable.
 */

const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access']

/** The development-only issuer. Never reachable when NODE_ENV=production. */
const DEV_ISSUER = 'http://localhost:4000'

export interface AuthResolution {
  port: AuthPort
  configured: boolean
  /** Names only — never values. Safe to log. */
  missing: string[]
}

const unconfigured = (missing: string[]): AuthResolution => ({
  port: unconfiguredAuthPort,
  configured: false,
  missing,
})

/**
 * Build the real port, or the fail-closed default.
 *
 * Node-only by construction: the edge runtime has no MigraAuth session, and the
 * auth-client is a server module. Callers on edge get the fail-closed port.
 */
export async function resolveAuthPort(): Promise<AuthResolution> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') {
    return unconfigured(['NEXT_RUNTIME!=nodejs'])
  }

  const missing: string[] = []

  // Opaque values: presence is all that can be checked. `clientSecret` is
  // deliberately absent — the issuer advertises `none`, so a public PKCE client
  // is valid and no secret is issued for `migrapilot_web`.
  const clientId = readEnv('MIGRAAUTH_CLIENT_ID')
  if (!clientId) missing.push('MIGRAAUTH_CLIENT_ID')

  const sessionSecret = readEnv('APP_SESSION_SECRET')
  if (!sessionSecret) missing.push('APP_SESSION_SECRET')

  // URLs: presence is not enough. Each of these is used to build an absolute
  // redirect or an outbound request, so a relative or non-http value is a
  // misconfiguration that must fail closed here, not throw mid-request.
  const redirectUri = absoluteHttpUrl(readEnv('MIGRAAUTH_REDIRECT_URI'))
  if (!redirectUri) missing.push('MIGRAAUTH_REDIRECT_URI')

  const appBaseUrl = absoluteHttpUrl(readEnv('APP_BASE_URL'))
  if (!appBaseUrl) missing.push('APP_BASE_URL')

  // The issuer origin carries BOTH ends of the flow: the browser's authorize
  // redirect and the server's `/token` and `/userinfo` calls are built from it
  // (`packages/auth-client/src/oauth.ts`). There is no correct production value
  // to guess, so a missing issuer fails closed rather than silently pointing a
  // deployed app at localhost.
  const issuer =
    absoluteHttpUrl(readFirstEnv('MIGRAAUTH_BASE_URL', 'AUTH_PUBLIC_URL')) ??
    (isProduction() ? undefined : DEV_ISSUER)
  if (!issuer) missing.push('MIGRAAUTH_BASE_URL')

  if (missing.length > 0) return unconfigured(missing)

  // Non-null after the guard above; TypeScript cannot narrow across the push.
  const resolvedIssuer = issuer!

  // MigraAuth serves its sign-in UI from the issuer origin in this deployment —
  // `/authorize` redirects to `/login` on the same host. Falling back to the
  // issuer rather than to a localhost default keeps signup and logout on the
  // host that just authenticated the user.
  const webUrl = absoluteHttpUrl(readFirstEnv('MIGRAAUTH_WEB_URL', 'AUTH_WEB_URL')) ?? resolvedIssuer

  const postLogoutRedirectUri =
    absoluteHttpUrl(readEnv('MIGRAAUTH_POST_LOGOUT_REDIRECT_URI')) ?? appBaseUrl!

  const configuredScopes = readEnv('MIGRAAUTH_SCOPES')?.split(/\s+/).filter(Boolean)
  const scopes = configuredScopes?.length ? configuredScopes : DEFAULT_SCOPES

  const clientSecret = readEnv('MIGRAAUTH_CLIENT_SECRET')

  const { initAuthClient } = await import('@migrateck/auth-client')
  const { migraAuthPort } = await import('./migraAuthPort')

  initAuthClient({
    migraAuthBaseUrl: resolvedIssuer,
    migraAuthWebUrl: webUrl,
    clientId: clientId!,
    ...(clientSecret ? { clientSecret } : {}),
    redirectUri: redirectUri!,
    postLogoutRedirectUri,
    appBaseUrl: appBaseUrl!,
    scopes,
    sessionCookieName: readEnv('APP_SESSION_COOKIE_NAME') ?? 'migrapilot_consumer_session',
    sessionSecret: sessionSecret!,
  })

  return { port: migraAuthPort, configured: true, missing: [] }
}
