import 'server-only'

/**
 * Reading MigraAuth on behalf of the signed-in user.
 *
 * WHY A SERVER-SIDE CALL AT ALL. Sessions, linked providers and security
 * activity are MigraAuth's truth, and Settings must show that truth rather than
 * a copy. The browser cannot fetch it: CORS blocks `chat.migrateck.com` and the
 * MigraAuth session cookie is `SameSite=lax`, so it would not be sent
 * cross-site even if CORS allowed it. Both were checked against production, not
 * assumed.
 *
 * WHY THE USER'S OWN TOKEN. The alternative — a service credential — would let
 * this application ask MigraAuth about ANY user. The OIDC access token
 * authorizes exactly the person who signed in, which is the authority actually
 * needed and no more.
 *
 * NOTHING HERE IS CACHED OR MIRRORED. Every read goes to MigraAuth. A local copy
 * of a session list or a provider link is a second truth that goes stale the
 * moment someone revokes a session on another device — which is precisely the
 * moment the screen most needs to be right.
 */

import { getSession } from './index'
import { readEnv, readFirstEnv, absoluteHttpUrl } from './env'
import type { AppSession } from './authPort'

interface StoredTokens {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt: number
}

export type MigraAuthResult<T> =
  | { kind: 'ok'; value: T; renewed?: StoredTokens }
  | { kind: 'unauthenticated' }
  /** The session predates token capture, or the token expired and could not be renewed. */
  | { kind: 'reauth_required' }
  | { kind: 'unavailable'; status: number }

function issuer(): string | null {
  return absoluteHttpUrl(readFirstEnv('MIGRAAUTH_BASE_URL', 'AUTH_PUBLIC_URL')) ?? null
}

/** The tokens this session captured at sign-in, if it captured any. */
function tokensOf(session: AppSession): StoredTokens | null {
  const stored = (session.productAccount as { migraAuth?: StoredTokens } | null | undefined)?.migraAuth
  if (!stored || typeof stored.accessToken !== 'string' || !stored.accessToken) return null
  return stored
}

/**
 * Exchange a refresh token for a new access token.
 *
 * `migrapilot_web` is a PUBLIC PKCE client — the issuer advertises `none` and no
 * secret is issued — so the refresh carries the client id and nothing else. A
 * secret sent by a public client is not a credential; it is a string in a
 * bundle, and pretending otherwise is worse than not having one.
 */
async function refreshAccessToken(refreshToken: string): Promise<StoredTokens | null> {
  const base = issuer()
  const clientId = readEnv('MIGRAAUTH_CLIENT_ID')
  if (!base || !clientId) return null

  try {
    const response = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
      cache: 'no-store',
    })
    if (!response.ok) return null

    const payload = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!payload.access_token) return null

    return {
      accessToken: payload.access_token,
      ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : { refreshToken }),
      accessTokenExpiresAt: Date.now() + Math.max(0, (payload.expires_in ?? 900) - 30) * 1000,
    }
  } catch {
    return null
  }
}

/**
 * Call a MigraAuth endpoint as the signed-in user.
 *
 * A 401 from MigraAuth is reported as `reauth_required` rather than retried
 * forever. The remedy is a new sign-in, and a screen that spins instead of
 * saying so is a screen that never recovers.
 *
 * A RENEWED TOKEN COMES BACK IN THE RESULT rather than being stashed. Read
 * paths cannot set cookies, so the renewal serves this request and the next
 * request renews again; a route that CAN write the session may persist it. What
 * it must never be is module state — that is shared across concurrent requests,
 * and a bearer token parked there belongs to whoever reads it next.
 */
export async function migraAuthFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<MigraAuthResult<T>> {
  const session = await getSession()
  if (!session) return { kind: 'unauthenticated' }

  const base = issuer()
  if (!base) return { kind: 'unavailable', status: 0 }

  /*
   * Request-local, NEVER module-scoped. A module-level variable in a Node server
   * is shared by every concurrent request, so parking a bearer token there
   * hands one user's credential to whichever request reads it next. A renewal
   * travels back in the return value instead, where it belongs to exactly one
   * call.
   */
  let renewedThisCall: StoredTokens | null = null
  let tokens = tokensOf(session)
  if (!tokens) {
    /*
     * A session established BEFORE tokens were captured. Not an error and not a
     * fault — the person is genuinely signed in — but MigraAuth-sourced data
     * cannot be read for them until they sign in again. Saying so is the only
     * honest option; inventing an empty session list would be worse.
     */
    return { kind: 'reauth_required' }
  }

  if (tokens.accessTokenExpiresAt <= Date.now()) {
    if (!tokens.refreshToken) return { kind: 'reauth_required' }
    const renewed = await refreshAccessToken(tokens.refreshToken)
    if (!renewed) return { kind: 'reauth_required' }
    tokens = renewed
    renewedThisCall = renewed
  }

  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${tokens.accessToken}`,
        accept: 'application/json',
      },
      cache: 'no-store',
    })
  } catch {
    return { kind: 'unavailable', status: 0 }
  }

  if (response.status === 401 || response.status === 403) return { kind: 'reauth_required' }
  if (!response.ok) return { kind: 'unavailable', status: response.status }

  const value = (await response.json().catch(() => null)) as T
  return { kind: 'ok', value, ...(renewedThisCall ? { renewed: renewedThisCall } : {}) }
}
