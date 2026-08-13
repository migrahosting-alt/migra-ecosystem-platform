import 'server-only'

import {
  buildLoginRedirect,
  buildLogoutRedirect,
  clearAppSession,
  getAppSession,
  handleOAuthCallback,
} from '@migrateck/auth-client'

import type { AuthPort } from './authPort'

/**
 * The canonical MigraAuth adapter.
 *
 * Deliberately thin. Every OIDC concern — PKCE S256 challenge generation, state
 * verification, the `/token` exchange, `/userinfo`, and the httpOnly session
 * cookie — lives in `@migrateck/auth-client` and is NOT reimplemented here. This
 * file only translates that package's surface into the application's `AuthPort`,
 * which is what the tenancy layer and Brain gateway depend on.
 *
 *   @migrateck/auth-client → this adapter → AppSession → deriveBrainScope
 *
 * `clientSecret` and `sessionSecret` are read by the package from server
 * environment via `initAuthClient`, never by this module and never by anything
 * reachable from a client component — `server-only` above makes that a build
 * error rather than a convention.
 */
export const migraAuthPort: AuthPort = {
  getSession: () => getAppSession(),
  buildLoginRedirect: () => buildLoginRedirect(),
  buildLogoutRedirect: () => buildLogoutRedirect(),
  handleCallback: async ({ code, state, bootstrap }) => {
    await handleOAuthCallback({ code, state, bootstrap })
  },
  clearSession: () => clearAppSession(),
}
