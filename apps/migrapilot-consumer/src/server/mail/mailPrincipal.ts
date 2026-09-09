import 'server-only'

/**
 * CAN THIS CALLER CONNECT A MAILBOX AT ALL? Asked once, for every mail route.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY AN ANONYMOUS VISITOR MUST NOT REACH THIS AT ALL
 *
 * This is a stronger refusal than the project one, and for a different reason.
 * A project bound to an anonymous scope is merely lost when the session ends.
 * A MAILBOX bound to an anonymous scope leaves a live grant at Google —
 * standing access to a real person's email — attached to an identity that no
 * longer exists and that nothing in this product can ever resolve again in
 * order to revoke it.
 *
 * The user would have to go into their Google account and remove it by hand,
 * having been given no reason to think they needed to.
 *
 * So the gate is not "this screen would read badly for a visitor". It is that
 * the irreversible half of the operation happens at a third party, and we
 * would have destroyed our own ability to undo it.
 *
 * ---------------------------------------------------------------------------
 * AN ALLOWLIST, NOT A DENYLIST
 *
 * A principal kind added later is treated as incapable until someone decides
 * otherwise. For a control that hands out standing access to somebody's email,
 * the default must be refusal rather than inheritance.
 */

import type { Principal } from '@/server/tenancy/principal'

export function canConnectMail(principal: Principal): boolean {
  return principal.kind === 'session'
}

/**
 * The single refusal for a caller who cannot connect a mailbox.
 *
 * The response SHAPE differs per route, so each route formats this; what must
 * not be re-decided anywhere is the status, the remedy and the words.
 */
export const MAIL_SIGN_IN = Object.freeze({
  status: 401,
  error: 'unauthenticated',
  /*
   * Says what to do and claims nothing about what they have. "Email is not
   * connected" here would answer a question about an account we have not
   * identified.
   */
  message: 'Sign in to connect your email.',
  remedy: 'sign-in' as const,
})
