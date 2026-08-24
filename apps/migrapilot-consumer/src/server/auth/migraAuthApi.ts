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

/** MigraAuth's error envelope, as its routes send it. */
export interface RefusalBody {
  error?: { code?: string; message?: string }
}

export type MigraAuthResult<T> =
  | { kind: 'ok'; value: T; renewed?: StoredTokens }
  | { kind: 'unauthenticated' }
  /** The session predates token capture, or the token expired and could not be renewed. */
  | { kind: 'reauth_required' }
  /**
   * MigraAuth said no and said why — a 4xx with its reason intact. Distinct from
   * `unavailable` because a caller can often relay this straight to the user:
   * "set a password first, then unlink this provider" is an instruction, not a
   * fault.
   */
  | { kind: 'refused'; status: number; value: RefusalBody | null }
  | { kind: 'unavailable'; status: number }

/**
 * Where this SERVER reaches MigraAuth.
 *
 * `MIGRAAUTH_API_URL` first, deliberately. It is the private app-core endpoint,
 * and it is the only one that works: this host cannot reach
 * `auth.migrateck.com` at all — every request to the public name times out,
 * measured from the box rather than assumed — because the public name resolves
 * out to the edge and egress does not come back. The private address answered
 * `401` on `/v1/me`, which is reachability proven by refusal.
 *
 * The public issuer stays the fallback, since a deployment that shares a network
 * with nothing still needs somewhere to go.
 */
function issuer(): string | null {
  return (
    absoluteHttpUrl(readEnv('MIGRAAUTH_API_URL')) ??
    absoluteHttpUrl(readFirstEnv('MIGRAAUTH_BASE_URL', 'AUTH_PUBLIC_URL')) ??
    null
  )
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
 * The client secret is sent WHEN ONE IS CONFIGURED. A comment elsewhere in this
 * app records `migrapilot_web` as a public PKCE client with no secret; the
 * deployed environment has `MIGRAAUTH_CLIENT_SECRET` set, so the environment is
 * taken as the authority over the comment. Omitting a secret a confidential
 * client is registered with turns every refresh into an unexplained 401.
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
        ...(readEnv('MIGRAAUTH_CLIENT_SECRET')
          ? { client_secret: readEnv('MIGRAAUTH_CLIENT_SECRET')! }
          : {}),
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

  /*
   * A DELIBERATE REFUSAL IS NOT AN OUTAGE, AND ITS REASON IS WORTH KEEPING.
   *
   * Every non-2xx used to collapse into `unavailable`, which discarded the body
   * — so MigraAuth refusing to unlink someone's last sign-in method, with a
   * message telling them to set a password first, reached the user as "that
   * could not be changed right now". The instruction was in the response the
   * whole time and this line threw it away.
   *
   * 4xx is the server saying no ON PURPOSE and explaining why; 5xx and network
   * failures are the server failing, where there is nothing to relay. Only the
   * first carries a body worth forwarding.
   */
  if (response.status >= 400 && response.status < 500) {
    const body = (await response.json().catch(() => null)) as RefusalBody | null
    return { kind: 'refused', status: response.status, value: body }
  }

  if (!response.ok) return { kind: 'unavailable', status: response.status }

  const value = (await response.json().catch(() => null)) as T
  return { kind: 'ok', value, ...(renewedThisCall ? { renewed: renewedThisCall } : {}) }
}
