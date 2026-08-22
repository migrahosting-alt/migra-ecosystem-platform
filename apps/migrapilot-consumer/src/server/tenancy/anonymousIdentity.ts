/**
 * Anonymous identity → Brain owner scope.
 *
 * The Brain trusts `X-Owner-Scope` unconditionally. `ownerScope.ts` is the only
 * thing allowed to mint one for a signed-in user, derived solely from a verified
 * MigraAuth session. This module is its anonymous counterpart and carries the
 * SAME trust boundary: the scope is derived server-side from a signed token, and
 * the browser can neither choose nor edit it.
 *
 * What the browser holds is an opaque id plus an HMAC over it. It never holds
 * `anon:<something>` as an editable field — if it did, anyone could read anyone
 * else's anonymous conversation by changing one string.
 *
 * The signature is what makes the id AUTHORITY rather than a hint. An unsigned
 * random id in a cookie is just as guessable-by-substitution as a scope: the
 * point is not that the id is secret, it is that only this server can produce a
 * valid pair.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Namespace prefix. Distinct from `user:` so the two can never collide. */
export const ANON_OWNER_PREFIX = 'anon:'

export interface AnonymousIdentity {
  /** Opaque random id. Carries no meaning and is not derived from anything. */
  anonymousSessionId: string
  /** Derived server-side ONLY. */
  ownerScope: `anon:${string}`
}

export class AnonymousIdentityError extends Error {
  readonly code = 'ANONYMOUS_IDENTITY_INVALID'
  constructor(message: string) {
    super(message)
    this.name = 'AnonymousIdentityError'
  }
}

/**
 * The id alphabet is constrained to what the Brain accepts in a scope header
 * (`[A-Za-z0-9._~-]`), so a minted identity can never produce a header the Brain
 * rejects — or worse, one containing a delimiter that lets one identity read as
 * another.
 */
const ID = /^[A-Za-z0-9_-]{22,64}$/

const b64url = (b: Buffer): string => b.toString('base64url')

function sign(id: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(id).digest())
}

/** Mint a fresh anonymous identity. Server-side only. */
export function mintAnonymousIdentity(secret: string): {
  identity: AnonymousIdentity
  cookieValue: string
} {
  assertSecret(secret)
  const anonymousSessionId = b64url(randomBytes(24))
  return {
    identity: {
      anonymousSessionId,
      ownerScope: `${ANON_OWNER_PREFIX}${anonymousSessionId}` as `anon:${string}`,
    },
    cookieValue: `${anonymousSessionId}.${sign(anonymousSessionId, secret)}`,
  }
}

/**
 * Verify a cookie and derive the scope, or throw.
 *
 * FAILS CLOSED. There is no "unverified but probably fine" path: a bad
 * signature, a malformed id, or a missing secret yields an error, and the caller
 * mints a new identity rather than honouring a suspect one. Degrading to a
 * shared or default scope here would put every anonymous visitor in one bucket
 * reading each other's conversations.
 */
export function verifyAnonymousCookie(cookieValue: string, secret: string): AnonymousIdentity {
  assertSecret(secret)
  if (typeof cookieValue !== 'string' || !cookieValue.includes('.')) {
    throw new AnonymousIdentityError('Anonymous cookie is missing or malformed.')
  }

  const separator = cookieValue.lastIndexOf('.')
  const id = cookieValue.slice(0, separator)
  const signature = cookieValue.slice(separator + 1)

  if (!ID.test(id)) throw new AnonymousIdentityError('Anonymous session id is not canonical.')

  const expected = Buffer.from(sign(id, secret))
  const supplied = Buffer.from(signature)
  // Length must match before timingSafeEqual, which throws on a mismatch —
  // and the length check itself must not short-circuit into a different error
  // path that leaks whether the length was right.
  const valid = expected.length === supplied.length && timingSafeEqual(expected, supplied)
  if (!valid) throw new AnonymousIdentityError('Anonymous cookie signature is invalid.')

  return {
    anonymousSessionId: id,
    ownerScope: `${ANON_OWNER_PREFIX}${id}` as `anon:${string}`,
  }
}

/** True when a scope was minted by this module. Never trust a browser string. */
export function isAnonymousScope(scope: string): scope is `anon:${string}` {
  if (!scope.startsWith(ANON_OWNER_PREFIX)) return false
  return ID.test(scope.slice(ANON_OWNER_PREFIX.length))
}

function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.trim().length < 16) {
    throw new AnonymousIdentityError(
      'Anonymous identity requires APP_SESSION_SECRET; refusing to sign with a weak or missing key.',
    )
  }
}

/** Cookie attributes. Mirrors the authenticated session cookie deliberately. */
export const ANONYMOUS_COOKIE_NAME = 'migrapilot_anon'
export const ANONYMOUS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  /** 30 days. Long enough that a visitor's conversation survives a return visit. */
  maxAge: 60 * 60 * 24 * 30,
} as const
