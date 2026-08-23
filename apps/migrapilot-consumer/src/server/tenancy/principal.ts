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
 * WHO MAY PERFORM WHICH OPERATION.
 *
 * The gateway resolves a principal and then authorizes THE EXACT OPERATION
 * against this table. Two separate decisions, deliberately: "we know who you
 * are" is not "you may do this", and collapsing them is how admitting anonymous
 * visitors to chat would have admitted them to everything else the Brain can do.
 *
 * CLOSED BY DEFAULT IN BOTH DIRECTIONS. An operation absent from this table is
 * `authenticated` — so every capability added to the Brain in future is shut to
 * the public internet until someone lists it here on purpose. A denylist would
 * have the opposite default and would be wrong exactly once, silently.
 *
 *   both           chat and its own conversation: what "try it before you sign
 *                  in" actually needs.
 *   anonymous      the allowance itself. An authenticated caller has no quota,
 *                  and asking for one is a bug worth refusing here rather than
 *                  discovering as a Brain 400.
 *   authenticated  everything else — files, indexes, coding, transcription,
 *                  grounding, and the claim, which is made AS the account.
 */
export type OperationAudience = 'both' | 'anonymous' | 'authenticated'

const OPERATION_AUDIENCE: Readonly<Record<string, OperationAudience>> = {
  // Chat, and the conversation it lives in.
  listConversations: 'both',
  createConversation: 'both',
  getConversation: 'both',
  listMessages: 'both',
  appendMessage: 'both',
  // Streaming is a FLAG on this operation, not a separate kind — so admitting
  // `chatTurn` admits both paths, which is what the slice needs and is why the
  // decision is made in the gateway rather than per route.
  chatTurn: 'both',

  // The allowance. Only a signed-out visitor has one.
  anonymousQuota: 'anonymous',
  reserveAnonymousTurn: 'anonymous',
  settleAnonymousTurn: 'anonymous',

  // The transfer INTO an account. Never reachable by the visitor being claimed.
  claimAnonymousConversation: 'authenticated',

  /*
   * Preferences belong to whoever is asking. A signed-out visitor has a scope of
   * their own, so their theme is theirs — and the isolation that makes that safe
   * is the same row-level security every other scoped read relies on.
   */
  getPreferences: 'both',
  patchPreferences: 'both',
  preferenceEvents: 'both',
}

/** The audience for an operation. Unknown operations are authenticated-only. */
export function operationAudience(kind: string): OperationAudience {
  return OPERATION_AUDIENCE[kind] ?? 'authenticated'
}

export function isAnonymousAllowedOperation(kind: string): boolean {
  const audience = operationAudience(kind)
  return audience === 'both' || audience === 'anonymous'
}

export function isAuthenticatedAllowedOperation(kind: string): boolean {
  return operationAudience(kind) !== 'anonymous'
}

/** Why an operation was refused for this principal, or nothing. */
export interface OperationRefusal {
  detail: string
}

/**
 * Authorize ONE operation for ONE principal.
 *
 * Returns `null` when permitted. The refusal text names the operation, because
 * a capability refusal a developer cannot locate becomes a bug report about
 * "chat being broken".
 */
export function authorizeOperation(
  principal: Pick<Principal, 'kind'>,
  kind: string,
): OperationRefusal | null {
  if (principal.kind === 'anonymous') {
    return isAnonymousAllowedOperation(kind)
      ? null
      : {
          detail:
            `'${kind}' is not available without an account. Sign in to use it.`,
        }
  }

  return isAuthenticatedAllowedOperation(kind)
    ? null
    : {
        detail: `'${kind}' applies only to a signed-out visitor.`,
      }
}
