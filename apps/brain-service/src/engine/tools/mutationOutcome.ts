/**
 * OUTCOMES FOR A MUTATION, AND THE ONE THAT MOST SYSTEMS REFUSE TO ADMIT.
 *
 * ---------------------------------------------------------------------------
 * 🚨 `outcome_unknown_after_dispatch`
 *
 * The request went out and the connection died before we learned whether the
 * backend committed it. There are exactly two comfortable lies available:
 *
 *   "failed"     — which invites a retry that may double the effect
 *   "succeeded"  — which tells the user something we do not know
 *
 * Both are worse than the truth. This is the same invariant as a deploy step
 * that cannot reach the running service: INABILITY TO OBSERVE STATE IS NOT
 * EVIDENCE OF STATE. It gets its own outcome so no caller has to pick a lie,
 * and so a UI can say "we are checking" rather than inventing a verdict.
 *
 * `backend_failed_before_side_effect` is deliberately separate from it. A
 * validation refusal, a missing row, a rejected write that never began — those
 * are safe to retry, and collapsing them into "unknown" would make every
 * ordinary failure look dangerous.
 * ---------------------------------------------------------------------------
 */

export type MutationOutcome =
  | 'success'
  | 'refused_policy'
  | 'preflight_failed'
  /** The write never started. Safe to retry. */
  | 'backend_failed_before_side_effect'
  /** Dispatched, and we do not know whether it committed. NEVER retry blindly. */
  | 'outcome_unknown_after_dispatch';

/**
 * How far the invocation got, recorded separately from whether it worked.
 *
 * Consent issuance is NOT the start of the mutation. Keeping `approved` distinct
 * from `dispatch_started` is what lets provenance answer "did we ever actually
 * try?" — which becomes the difference between a duplicate email and a lost one
 * once this framework reaches sends, deletes and billing.
 */
export type DispatchStage =
  | 'approved'
  | 'dispatch_started'
  | 'committed'
  | 'failed_before_commit'
  | 'outcome_unknown';

/**
 * Does this error mean the write MIGHT have landed?
 *
 * Anything that severed the connection or timed out after dispatch is
 * indeterminate. A clear rejection — not found, invalid, refused — is not: the
 * backend answered, and its answer was no.
 *
 * Defaults to INDETERMINATE for an unrecognised error, because assuming a
 * mystery failure was safe is how a retry duplicates a side effect. The cost of
 * being wrong in this direction is a needless check; in the other it is a second
 * charge, a second email, a second delete.
 */
export function isIndeterminate(error: unknown): boolean {
  const text = String(
    (error as { code?: string; message?: string })?.code ??
      (error as { message?: string })?.message ??
      error ??
      '',
  ).toLowerCase();

  const clearlyRejected = [
    'not found',
    'notfound',
    'unknown_conversation',
    'invalid',
    'validation',
    'forbidden',
    'unauthorized',
    'refused',
    'bad request',
  ];
  if (clearlyRejected.some((s) => text.includes(s))) return false;
  return true;
}
