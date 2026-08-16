/**
 * Identity → Brain owner scope.
 *
 * The Brain derives conversation tenancy from the `X-Owner-Scope` and
 * `X-Workspace-Scope` request headers and trusts them unconditionally
 * (`brain-service/src/engine/memory/memoryRoutes.ts:23`). Those headers are
 * therefore transport metadata, NOT a secret: the security property comes from
 * this module being the only thing that can produce them, and from it deriving
 * them solely from a verified MigraAuth session.
 *
 * Rules, in order of importance:
 *
 *   1. Only canonical, stable identifiers. `authUserId` is the OIDC `sub`.
 *      Never an email, display name, org *name*, or anything a browser sent.
 *   2. Fail closed. If a canonical user identity cannot be established, this
 *      throws — it never degrades to a shared or default scope. The Brain's own
 *      fallback is the literal string `local`, so a silent degrade here would
 *      drop every user into one shared bucket.
 *   3. Owner is always the user. Org context narrows the *workspace* dimension
 *      rather than replacing the owner, so losing org context can never widen
 *      access across users — it degrades to that user's personal namespace.
 */

import type { AppSession } from '../auth/authPort'

/** The scope pair sent to the Brain. */
export interface BrainScope {
  /** `X-Owner-Scope` */
  owner: string
  /** `X-Workspace-Scope` */
  workspace: string
}

export class TenancyError extends Error {
  readonly code = 'TENANCY_UNRESOLVED'
  constructor(message: string) {
    super(message)
    this.name = 'TenancyError'
  }
}

/**
 * Canonical identifiers must be non-empty and free of characters that could
 * confuse a header value or let one identity impersonate another by containing
 * the delimiter. Anything else is a bug or an attack, and both fail closed.
 */
const CANONICAL_ID = /^[A-Za-z0-9._~-]{1,128}$/

function assertCanonical(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TenancyError(`Cannot derive Brain scope: ${label} is missing.`)
  }
  const trimmed = value.trim()
  if (!CANONICAL_ID.test(trimmed)) {
    throw new TenancyError(
      `Cannot derive Brain scope: ${label} is not a canonical identifier.`,
    )
  }
  return trimmed
}

/** Namespace prefixes. Distinct so a user id can never collide with an org id. */
export const OWNER_PREFIX = 'user:'
export const ORG_WORKSPACE_PREFIX = 'org:'
/**
 * Prefix for the workspace a user gets when no organization context exists.
 *
 * It is PER USER, not a shared literal. It used to be the constant `personal`,
 * which put every org-less user — that is, every consumer user today — in one
 * shared workspace. Conversations survived that because the Brain scopes them by
 * owner AND workspace, and owner is unique. Semantic indexes do NOT: both
 * `approvedIndexFor` and `listForScope` match on workspace alone
 * (`apps/brain-service/src/engine/rag/indexService.ts`).
 *
 * So the moment any consumer index became approved, one user's private uploaded
 * documents would have been retrieved as grounding evidence for another user's
 * question. Nothing was leaked because no consumer index had ever been
 * approved — the Files slice was about to make that true for the first time.
 *
 * A per-user workspace is strictly narrowing and cannot widen access.
 */
export const PERSONAL_WORKSPACE_PREFIX = 'personal:'

/**
 * Derive the Brain scope for a verified session.
 *
 * Format (documented contract):
 *
 *   owner     = "user:<authUserId>"                        — always the OIDC sub
 *   workspace = "org:<activeOrgId>" | "personal:<sub>"     — org narrows, never widens
 *
 * If organization-scoped *shared* memory is ever required, `owner` would have
 * to become `org:<id>`. That is a deliberate future migration with data
 * implications, not something to be inferred at runtime.
 */
export function deriveBrainScope(session: AppSession | null | undefined): BrainScope {
  if (!session) {
    throw new TenancyError('Cannot derive Brain scope: no authenticated session.')
  }

  const authUserId = assertCanonical(session.authUserId, 'authUserId')

  // Org context is optional today: `/userinfo` does not yet carry org claims
  // (PR #147 pending), so it arrives via the bootstrap step and may be absent.
  // Absent org means a narrower namespace, never a broader one.
  // Per user, never a shared literal — see PERSONAL_WORKSPACE_PREFIX.
  let workspace = `${PERSONAL_WORKSPACE_PREFIX}${authUserId}`
  if (session.activeOrgId !== undefined && session.activeOrgId !== null) {
    workspace = `${ORG_WORKSPACE_PREFIX}${assertCanonical(session.activeOrgId, 'activeOrgId')}`
  }

  return { owner: `${OWNER_PREFIX}${authUserId}`, workspace }
}

/**
 * True when a value could be a scope this module produced. Used by the gateway
 * to assert it never emits a caller-supplied value.
 */
export function isDerivedOwnerScope(value: string): boolean {
  return value.startsWith(OWNER_PREFIX) && CANONICAL_ID.test(value.slice(OWNER_PREFIX.length))
}
