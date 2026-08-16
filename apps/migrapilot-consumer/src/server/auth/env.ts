import 'server-only'

/**
 * Environment reading for auth configuration.
 *
 * WHY THIS EXISTS. `process.env.X ?? fallback` only falls back on `undefined`.
 * An exported-but-empty variable (`MIGRAAUTH_BASE_URL=`) is a string, so `??`
 * accepts it and the empty origin propagates into URL construction. That is not
 * hypothetical — production release v5b answered `/api/auth/login` with:
 *
 *   TypeError: Failed to parse URL from /authorize?response_type=code&client_id=…
 *   { code: 'ERR_INVALID_URL' }
 *
 * The issuer origin was the empty string, so the authorize URL that must be
 * absolute was emitted as a bare path and `Response.redirect` rejected it. An
 * empty variable is an unset variable; accepting it as configuration is what
 * turns a misconfiguration into a 500 at request time instead of a clear
 * fail-closed state at resolution time.
 */

/** A variable that is unset, empty, or whitespace-only reads as absent. */
export function readEnv(name: string): string | undefined {
  const raw = process.env[name]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/** The first of `names` that is actually present. Used for aliased variables. */
export function readFirstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name)
    if (value !== undefined) return value
  }
  return undefined
}

const trimTrailingSlashes = (url: string): string => url.replace(/\/+$/, '')

/**
 * An absolute http(s) URL with trailing slashes removed, or `undefined`.
 *
 * Absoluteness is checked here rather than at the point of use so that a bad
 * value fails closed during resolution instead of throwing inside a request.
 * A relative value is exactly what produced the v5b crash above.
 */
export function absoluteHttpUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  return trimTrailingSlashes(value)
}

/** Development-only defaults must never be reachable in a production build. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}
