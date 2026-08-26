import 'server-only'

/**
 * Where to put the browser back after a sign-in.
 *
 * A visitor signs in FROM a conversation, and must land back in it. The
 * conversation id survives the claim, so `/chat/<id>` is still the right
 * address — what has to survive is the round trip through the identity
 * provider, which this app does not control the state of.
 *
 * IT TRAVELS IN AN httpOnly COOKIE, NOT IN THE REDIRECT. A destination carried
 * through the OAuth query string is an open-redirect surface: the value comes
 * back from a third party and would be handed straight to `Response.redirect`.
 * Keeping it server-side means the only thing that can set it is a request to
 * this application's own login route.
 *
 * AND IT IS STILL VALIDATED. Even a cookie this app wrote is checked before use,
 * because "we set it" is a claim about the past and the check is cheap: an
 * absolute URL, a protocol-relative `//host` (which browsers treat as absolute),
 * or a backslash variant are all refused in favour of the home page.
 */

import { cookies } from 'next/headers'

export const RETURN_COOKIE = 'migrapilot_after_login'

const RETURN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  /** Long enough for a sign-in, short enough not to outlive the intent. */
  maxAge: 600,
} as const

/** A control character in a Location header is a response-splitting attempt. */
const CONTROL = /[\u0000-\u001F\u007F]/

/**
 * A same-origin path, or nothing.
 *
 * Deliberately strict: one leading slash, no second slash, no backslash, no
 * scheme. Anything else is not a path this application can promise to own.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  if (value.includes('\\')) return null
  if (CONTROL.test(value)) return null
  return value
}

export async function rememberReturnPath(value: string | null | undefined): Promise<void> {
  const path = safeReturnPath(value)
  if (!path) return
  try {
    const jar = await cookies()
    jar.set(RETURN_COOKIE, path, RETURN_COOKIE_OPTIONS)
  } catch {
    // No writable cookie jar. The sign-in still works; it lands on the home page.
  }
}

/**
 * A redirect that CARRIES the destination.
 *
 * WHY THIS EXISTS ALONGSIDE `rememberReturnPath`. A cookie written through
 * `cookies()` is only emitted when the framework builds the response. The login
 * route returned a bare `Response.redirect(...)`, so the `Set-Cookie` header was
 * silently dropped and the destination never left the server — the sign-in link
 * carried `?next=/chat/<id>`, the value was validated and "stored", and the user
 * still landed on the home page with their conversation nowhere in sight.
 *
 * The response is CONSTRUCTED with the header rather than mutated afterwards:
 * `Response.redirect()` returns immutable headers, so appending to one throws.
 * Building it here means the cookie is present because it was put there, with no
 * dependence on framework association at all.
 */
export function redirectRememberingReturnPath(location: string, value: string | null | undefined): Response {
  const headers = new Headers({ location })
  const path = safeReturnPath(value)
  if (path) {
    headers.append(
      'set-cookie',
      [
        `${RETURN_COOKIE}=${encodeURIComponent(path)}`,
        `Path=${RETURN_COOKIE_OPTIONS.path}`,
        `Max-Age=${RETURN_COOKIE_OPTIONS.maxAge}`,
        // Lax, not Strict: the callback arrives as a top-level navigation FROM
        // the identity provider, and Strict would withhold the cookie there —
        // which is the same failure by a different route.
        'SameSite=Lax',
        'HttpOnly',
        'Secure',
      ].join('; '),
    )
  }
  return new Response(null, { status: 302, headers })
}


/**
 * A cookie value may arrive percent-encoded, and must still be recognised.
 *
 * `/chat/c1` written as `%2Fchat%2Fc1` fails `safeReturnPath` on its very first
 * check — it does not start with `/`, it starts with `%` — so the destination is
 * silently discarded and the user lands on the home page. Decoding an
 * unencoded path is a no-op, so this is safe in both directions, and a value
 * that cannot be decoded is used as-is rather than thrown away.
 */
function decodeCookieValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Read the remembered destination and consume it. Single use, by design. */
export async function takeReturnPath(): Promise<string | null> {
  try {
    const jar = await cookies()
    const raw = jar.get(RETURN_COOKIE)?.value
    jar.delete(RETURN_COOKIE)
    // Validated AFTER decoding — the check is on the real path, not its encoding.
    return safeReturnPath(decodeCookieValue(raw))
  } catch {
    return null
  }
}
