/**
 * A real cookie jar for tests, standing in for `next/headers`.
 *
 * WHY THIS IS NEEDED. `cookies()` throws outside a request scope, and
 * `node --test` has none. Without a jar, every anonymous path is untestable:
 * the principal resolver reads the visitor's cookie and WRITES the one it mints,
 * and "a minted identity that could not be written" is a distinct outcome the
 * routes act on. Stubbing it away would have left the whole signed-out flow
 * asserted only in production.
 *
 * It behaves like the mutable jar a Route Handler gets — `set` is visible to a
 * later `get` in the same request — because that is precisely the behaviour the
 * sign-in claim depends on: the session cookie is written by the exchange and
 * read back by `getSession()` before anything is moved.
 *
 * `__readOnly` reproduces the OTHER context: a Server Component, where reads
 * work and writes throw. That is the case the gateway refuses rather than
 * serving an identity that will not survive the response.
 */

const store = new Map()
let readOnly = false

const jar = {
  get(name) {
    const value = store.get(name)
    return value === undefined ? undefined : { name, value }
  },
  getAll() {
    return [...store.entries()].map(([name, value]) => ({ name, value }))
  },
  has(name) {
    return store.has(name)
  },
  set(name, value) {
    if (readOnly) throw new Error('Cookies can only be modified in a Server Action or Route Handler.')
    store.set(name, typeof value === 'string' ? value : String(value))
  },
  delete(name) {
    if (readOnly) throw new Error('Cookies can only be modified in a Server Action or Route Handler.')
    store.delete(name)
  },
}

export async function cookies() {
  return jar
}

export async function headers() {
  return new Headers()
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} }
}

/* ── test controls ──────────────────────────────────────────────────────── */

export function __setCookie(name, value) {
  store.set(name, value)
}

export function __getCookie(name) {
  return store.get(name)
}

export function __resetCookies() {
  store.clear()
  readOnly = false
}

/** Simulate a Server Component: reads succeed, writes throw. */
export function __setReadOnly(value) {
  readOnly = value
}
