import 'server-only'

/**
 * CAN THIS CALLER HOLD A PROJECT AT ALL? Asked once, for every project route.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT THIS EXISTS FOR
 *
 * An anonymous visitor created a conversation, read it, and got an answer in
 * it. The project rail then told them:
 *
 *   "You do not have access to this conversation.
 *    Ask whoever manages it for access."
 *
 * Both halves were false. They had access — they were reading it. And there is
 * no "whoever manages it": they made it themselves, seconds earlier. The
 * sentence sent a person to ask a nonexistent administrator for permission they
 * already had.
 *
 * ---------------------------------------------------------------------------
 * WHY IT HAPPENED, AND WHY IT IS A MAPPING BUG RATHER THAN A HOLE
 *
 * `resolveRequestPrincipal()` returns a real principal for an anonymous
 * visitor — that is what makes anonymous chat work — so the routes' `!resolved`
 * guard never fired. The call reached the Brain, the Brain found no project
 * grant for an anonymous scope, and answered `forbidden_for_principal`. The
 * route then rendered the only sentence it had for a forbidden result:
 * revoked access.
 *
 * So the system refused too much, never too little. No grant was issued, no
 * boundary was crossed, and the fix must not touch authorization at all —
 * only the mapping from "who is asking" to "what is true for them".
 *
 * ---------------------------------------------------------------------------
 * THE DISTINCTION, STATED ONCE
 *
 * "Not permitted" and "not capable" are different facts and need different
 * screens:
 *
 *   revoked      → a signed-in user who HAD access and lost it. Asking the
 *                  owner is the real remedy.
 *   anonymous    → a visitor for whom projects do not exist as a concept yet.
 *                  Signing in is the real remedy; asking anyone for access is
 *                  advice they cannot act on.
 *
 * Only the consumer can tell these apart, because only the consumer knows the
 * caller's kind. The Brain sees a scope with no grants and is right to refuse.
 * That is why this lives here and not there — and why all three project routes
 * ask this one function rather than each re-deciding it.
 */

import type { Principal } from '@/server/tenancy/principal'

/**
 * Whether a principal is the kind of thing that can be granted a project.
 *
 * Deliberately an allowlist on `session`, not a denylist on `anonymous`: a
 * principal kind added later is treated as incapable until someone decides
 * otherwise, which fails toward the truthful screen rather than toward a
 * confident claim about access.
 */
export function canHoldProjects(principal: Principal): boolean {
  return principal.kind === 'session'
}

/**
 * The single refusal for a caller who cannot hold projects.
 *
 * `remedy: 'sign-in'` — never 'request-read-access'. The response SHAPE differs
 * per route (`{connected:false,…}`, `{ok:false,…}`, `{error,…}` are three
 * separate contracts), so each route formats this; what must not be re-decided
 * anywhere is the status, the remedy and the words.
 */
export const PROJECT_SIGN_IN = Object.freeze({
  status: 401,
  error: 'unauthenticated',
  /*
   * Says what to do, and claims nothing about what they have. "No projects
   * available" here would assert an entitlement we have not looked up; "no
   * access to this conversation" would assert something we know to be false.
   */
  message: 'Sign in to connect a project to this conversation.',
  remedy: 'sign-in' as const,
})

/** The same fact, phrased for the list endpoint, which is not about one conversation. */
export const PROJECT_LIST_SIGN_IN = Object.freeze({
  status: 401,
  error: 'unauthenticated',
  message: 'Sign in to see your projects.',
  remedy: 'sign-in' as const,
})
