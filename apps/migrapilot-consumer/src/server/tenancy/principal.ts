/**
 * Who is making this request — a signed-in account, or a signed-out visitor.
 *
 * This is the seam that lets a stranger talk to MigraPilot before signing in,
 * and it is therefore the seam most worth being strict at.
 *
 * ORDER IS NOT A PREFERENCE. An authenticated session ALWAYS wins. If a browser
 * carries both a valid session and an old anonymous cookie, honouring the
 * anonymous one would silently downgrade a paying user into a five-turn limit
 * and file their conversations under a scope they cannot see once the cookie
 * expires.
 *
 * THE BROWSER NEVER SUPPLIES A SCOPE. It holds an opaque id and an HMAC over it.
 * The scope is computed here, from a verified signature, and nowhere else. An
 * unsigned id in a cookie would be exactly as forgeable as a scope header.
 *
 * FAILS CLOSED, AND FAILS TOWARD A NEW IDENTITY. A malformed or badly signed
 * anonymous cookie does NOT degrade to a shared bucket; it mints a fresh
 * identity. The visitor loses their history — which is the correct outcome for a
 * cookie we cannot prove we issued — rather than being dropped into a scope
 * where they can read someone else's.
 */

import type { AppSession } from '../auth/authPort'
import { deriveBrainScope, type BrainScope } from './ownerScope'
import {
  ANON_OWNER_PREFIX,
  mintAnonymousIdentity,
  verifyAnonymousCookie,
  type AnonymousIdentity,
} from './anonymousIdentity'

export const ANON_COOKIE = 'migrapilot_anon'

export type Principal =
  | { kind: 'session'; session: AppSession; scope: BrainScope }
  | {
      kind: 'anonymous'
      identity: AnonymousIdentity
      scope: BrainScope
      /** Set when a NEW identity was minted and the cookie must be written. */
      mintedCookie?: string
    }

export class AnonymousDisabledError extends Error {
  readonly code = 'ANONYMOUS_DISABLED'
  constructor(message: string) {
    super(message)
    this.name = 'AnonymousDisabledError'
  }
}

/**
 * An anonymous visitor's workspace IS their owner scope.
 *
 * A signed-out person has exactly one workspace. Inventing a second dimension
 * would be a distinction the product does not make, and would mean the claim had
 * to guess which of several workspaces to move.
 */
export function deriveAnonymousScope(identity: AnonymousIdentity): BrainScope {
  return { owner: identity.ownerScope, workspace: identity.ownerScope }
}

export interface PrincipalDeps {
  /** Resolves a verified session, or throws / returns null when signed out. */
  session: () => Promise<AppSession | null>
  /** The raw anonymous cookie value, if the browser sent one. */
  anonymousCookie: () => string | undefined
  /** HMAC secret. Absent means anonymous chat is not configured. */
  secret: () => string | undefined
}

/**
 * Resolve the principal for a request.
 *
 * Anonymous access is OFF unless a secret is configured. That is deliberate: an
 * unsigned anonymous identity is forgeable, so the absence of a secret must
 * disable the feature rather than weaken it.
 */
export async function resolveSessionOrAnonymous(deps: PrincipalDeps): Promise<Principal> {
  // 1. A verified session wins, unconditionally.
  let session: AppSession | null = null
  try {
    session = await deps.session()
  } catch {
    // Signed out, or a session that could not be verified. Either way this is
    // not an authenticated principal; it is not an error yet.
    session = null
  }
  if (session) {
    return { kind: 'session', session, scope: deriveBrainScope(session) }
  }

  // 2. Anonymous, only if we can sign it.
  const secret = deps.secret()
  if (!secret) {
    throw new AnonymousDisabledError(
      'Anonymous chat is not configured: no signing secret is set. Refusing to issue an unsigned ' +
        'anonymous identity, which any browser could forge.',
    )
  }

  const cookie = deps.anonymousCookie()
  if (cookie) {
    try {
      const identity = verifyAnonymousCookie(cookie, secret)
      return { kind: 'anonymous', identity, scope: deriveAnonymousScope(identity) }
    } catch {
      // Deliberately falls through to minting. A cookie we cannot prove we
      // issued gets replaced, never trusted and never mapped to a default.
    }
  }

  const { identity, cookieValue } = mintAnonymousIdentity(secret)
  return {
    kind: 'anonymous',
    identity,
    scope: deriveAnonymousScope(identity),
    mintedCookie: cookieValue,
  }
}

/** True when a scope was produced by the anonymous path. */
export function isAnonymousScope(owner: string): boolean {
  return owner.startsWith(ANON_OWNER_PREFIX)
}

/**
 * What a signed-out visitor is allowed to reach.
 *
 * An allowlist, not a denylist. Every operation added to the Brain in future is
 * closed to anonymous callers until someone decides otherwise — the opposite
 * default would silently expose each new capability to the public internet.
 *
 * Chat and its own conversation are in. Files, indexes, coding, transcription
 * and anything workspace-shaped are out: they cost more, they touch stored user
 * material, and none of them are part of "try it before you sign in".
 */
const ANONYMOUS_OPERATIONS = new Set([
  'listConversations',
  'createConversation',
  'getConversation',
  'listMessages',
  'appendMessage',
  // Streaming is a FLAG on this operation, not a separate kind — so admitting
  // `chatTurn` admits both paths, which is what the slice needs and is why the
  // allowlist is checked in the gateway rather than per route.
  'chatTurn',
])

export function isAnonymousAllowedOperation(kind: string): boolean {
  return ANONYMOUS_OPERATIONS.has(kind)
}
