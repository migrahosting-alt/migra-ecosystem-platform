/**
 * Starting — and re-starting — an email connection from the UI.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS FILE KNOWS NOTHING ABOUT GOOGLE
 *
 * No provider name, no endpoint, no scope, no OAuth vocabulary. It asks the
 * server where to send the user and sends them there. That is not tidiness: a
 * consumer that built its own authorization URL would be a second place where
 * the redirect URI and the requested scopes are decided, and the two would
 * drift — with the first symptom appearing at a user's sign-in.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A FAILURE MUST NOT NAVIGATE
 *
 * If the server could not start the flow, the browser stays put and the user is
 * told. Navigating anyway — to a half-built URL, or to Google without a stored
 * attempt — produces a consent screen whose callback is guaranteed to be
 * refused, after the user has already granted access to their mailbox.
 */

export type ConnectRemedy = 'connect-account' | 'reconnect-account'

/**
 * What the control says.
 *
 * 🚨 Connecting and reconnecting are worded differently on purpose. Someone
 * whose grant expired HAS an account linked; calling it "Connect" describes a
 * first-time action and hides that the authorization is what broke.
 */
export function remedyLabel(remedy: ConnectRemedy): string {
  return remedy === 'reconnect-account' ? 'Reconnect' : 'Connect'
}

export type BeginOutcome =
  | { ok: true; authorizationUrl: string }
  | { ok: false; message: string }

/** The one message a user sees when starting the flow fails. */
export const CONNECT_UNAVAILABLE =
  'Connecting your email is unavailable right now. Try again shortly.'

/** Sign-in is a different remedy from retrying, so it gets different words. */
export const CONNECT_SIGN_IN = 'Sign in to connect your email.'

export interface BeginDeps {
  fetchImpl?: typeof fetch
}

/**
 * Ask the server to start a connection.
 *
 * `returnTo` is where the user should land afterwards. It is sent as a PATH and
 * the server validates it; this side never builds an absolute URL from it,
 * because a value that becomes a redirect target is the easiest place in a web
 * app to turn a bug into an open redirect.
 */
export async function beginEmailConnection(
  returnTo: string,
  deps: BeginDeps = {},
): Promise<BeginOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl('/api/account/mail/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo }),
    })
  } catch {
    // The exception may carry the request. Nothing from it is shown or logged.
    return { ok: false, message: CONNECT_UNAVAILABLE }
  }

  if (response.status === 401) return { ok: false, message: CONNECT_SIGN_IN }

  let body: { authorizationUrl?: unknown }
  try {
    body = (await response.json()) as { authorizationUrl?: unknown }
  } catch {
    return { ok: false, message: CONNECT_UNAVAILABLE }
  }

  /*
   * 🚨 A URL IS REQUIRED, AND IT MUST BE ABSOLUTE HTTPS.
   *
   * A 200 with a missing or malformed value is treated as a failure rather than
   * navigated to. `location.assign('undefined')` would send the user to a
   * relative path inside our own app named "undefined" — a broken page that
   * looks like the product lost their click.
   */
  const url = typeof body.authorizationUrl === 'string' ? body.authorizationUrl : ''
  if (!response.ok || !isAbsoluteHttps(url)) return { ok: false, message: CONNECT_UNAVAILABLE }

  return { ok: true, authorizationUrl: url }
}

function isAbsoluteHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
