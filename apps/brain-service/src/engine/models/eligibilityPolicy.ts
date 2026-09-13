/**
 * TWO DIFFERENT QUESTIONS, WRITTEN DOWN AS TWO DIFFERENT QUESTIONS.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT THIS REPLACES
 *
 * The product already distinguished these, but only by accident: the UI family
 * gate read `requirements.governedCapability` against the qualification table,
 * while automatic routing read `enforceQual` against `qualification.state`.
 * Two code paths of different strictness, and the distinction between them was
 * an emergent property of that difference rather than anything anyone had
 * decided.
 *
 * The consequence was real and is live today: the router selects
 * `deepseek-r1:32b` for deep-tier work while Migra Logic correctly reports that
 * nothing is approved for `reasoning.deep`. That is *defensible* — but nobody
 * had ruled on it, and a rule nobody stated cannot be relied on.
 *
 * Owner ruling, 2026-09-13: the distinction stands, and it must be explicit.
 *
 *   PRODUCT PROMISE      a user picks "Migra Logic" and the product has told
 *                        them it can do deep reasoning. That is a claim, and a
 *                        claim needs a governed approval behind it.
 *
 *   IMPLEMENTATION CHOICE  the router picks a model for a turn nobody named.
 *                        No promise has been made about which model, so no
 *                        approval is required — but locality, cost, capacity
 *                        and integrity policy still apply.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE ONE THING INTERNAL ROUTING MAY NEVER DO
 *
 * It may not CLAIM the governed capability. Serving a deep-tier turn with an
 * unapproved model is an implementation choice; telling the user that turn was
 * "Migra Logic" would be the product asserting a promise governance never
 * granted. The boundary is the claim, not the model.
 */

/** Which of the two questions is being asked. */
export type EligibilityContext =
  /** A named, user-facing family. A governed approval is required. */
  | 'product-family'
  /** An unnamed turn routed automatically. No approval required. */
  | 'internal-routing';

export interface EligibilityInput {
  /** The governed capability the family declares, if it declares one. */
  governedCapability?: string | undefined;
  /** Does a live, integrity-checked approval exist for it? */
  approved: boolean;
  /** Weights run here. Never inferred from the provider label. */
  hosting?: 'on-device' | 'remote' | undefined;
  /** Remote models are opt-in per deployment. */
  allowRemote: boolean;
  /** The router's own qualification enforcement, for non-governed selection. */
  enforceQualification: boolean;
  qualificationState?: string | undefined;
}

export type EligibilityVerdict =
  | { eligible: true }
  | { eligible: false; reason: 'not_approved' | 'remote_not_allowed' | 'not_qualified' };

/**
 * May this model be used, for this kind of use?
 *
 * Locality is checked FIRST and for both contexts, because it is the one
 * constraint that is about where bytes go rather than about what was promised —
 * an internal routing decision that ships a prompt off the machine is not made
 * acceptable by nobody having named the model.
 */
export function isEligible(context: EligibilityContext, input: EligibilityInput): EligibilityVerdict {
  if (input.hosting === 'remote' && !input.allowRemote) {
    return { eligible: false, reason: 'remote_not_allowed' };
  }

  if (context === 'product-family') {
    // A family that declares no governed capability makes no governed promise,
    // and falls back to the router's own bar. That is how Migra Forge is
    // available on measured task-class grants with no approval row.
    if (!input.governedCapability) {
      return input.enforceQualification && input.qualificationState !== 'approved'
        ? { eligible: false, reason: 'not_qualified' }
        : { eligible: true };
    }
    return input.approved ? { eligible: true } : { eligible: false, reason: 'not_approved' };
  }

  // internal-routing: no promise was made, so no approval is required — but the
  // deployment's own enforcement still decides.
  return input.enforceQualification && input.qualificationState !== 'approved'
    ? { eligible: false, reason: 'not_qualified' }
    : { eligible: true };
}

/**
 * 🚨 MAY A TURN SERVED BY INTERNAL ROUTING BE ATTRIBUTED TO A GOVERNED FAMILY?
 *
 * No — unless that family's approval actually holds. This is the invariant the
 * whole split rests on: the product may quietly use a capable model, and may
 * never tell the user it used a capability nobody approved.
 */
export function mayClaimFamily(governedCapability: string | undefined, approved: boolean): boolean {
  return !governedCapability || approved;
}
