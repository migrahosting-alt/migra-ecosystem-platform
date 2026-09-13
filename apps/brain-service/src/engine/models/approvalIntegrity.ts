/**
 * AN APPROVAL IS FOR BYTES, NOT FOR A NAME.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE GAP THIS CLOSES
 *
 * `model_qualification_decisions` has always recorded `model_digest`, and the
 * approve route has always refused evidence that carries no digest —
 *
 *   "AND IT MUST NAME BYTES. The decision inherits its digest from this row, so
 *    evidence recorded without one would produce an approval that authorises a
 *    TAG — exactly the thing a digest exists to pin, since a tag can be
 *    repointed at different weights afterwards."
 *
 * — and then NOTHING EVER COMPARED IT to the model actually installed. The
 * digest was captured, stored, returned by `approvedByCapability`, and ignored.
 * So the precise failure that comment describes was live: `ollama pull` the same
 * tag, get different weights, and yesterday's approval silently covers them.
 *
 * ---------------------------------------------------------------------------
 * 🚨 FAIL CLOSED, INCLUDING WHEN THE ANSWER IS "I CANNOT TELL"
 *
 * Owner ruling, 2026-09-13: this is not warning-only. There are four ways to
 * fail and only one way to pass, and three of the four are silent today:
 *
 *   digest_mismatch   the tag now points at different bytes
 *   digest_unknown    the provider reports no digest, so integrity is unverifiable
 *   approval_unbound  the approval itself names no digest (a legacy row)
 *   model_absent      the approved model is not installed here
 *
 * `digest_unknown` and `approval_unbound` are the interesting ones. Neither is
 * evidence of tampering, and both are refusals anyway: a governed capability
 * that cannot verify its own integrity must decline rather than assume. The
 * alternative is a capability whose guarantee quietly degrades to "probably".
 */

import { normaliseDigest } from './modelRegistry.js';

export type IntegrityFailure =
  | 'digest_mismatch'
  | 'digest_unknown'
  | 'approval_unbound'
  | 'model_absent';

export type IntegrityVerdict =
  | { ok: true; modelId: string; digest: string }
  | { ok: false; modelId: string; reason: IntegrityFailure; detail: string };

/** Just enough of a decision to check it. Keeps this module free of the repo. */
export interface ApprovalLike {
  modelId: string;
  modelDigest?: string | undefined;
}

/**
 * Does this approval still cover what is installed?
 *
 * `liveDigest` is looked up rather than passed as a map so the caller can decide
 * what "installed" means — the registry, a single provider, or a test double.
 * Returning `undefined` means "no such model"; returning an empty string means
 * "the model is here but reports no digest", and those are different refusals.
 */
export function checkApprovalIntegrity(
  approval: ApprovalLike,
  liveDigest: (modelId: string) => string | undefined,
): IntegrityVerdict {
  const { modelId } = approval;

  const live = liveDigest(modelId);
  if (live === undefined) {
    return {
      ok: false, modelId, reason: 'model_absent',
      detail: `${modelId} is approved but is not installed on this host.`,
    };
  }

  if (!approval.modelDigest) {
    return {
      ok: false, modelId, reason: 'approval_unbound',
      detail:
        `the approval for ${modelId} names no digest, so it cannot be shown to cover ` +
        `the installed weights. It must be reissued against an exact digest.`,
    };
  }

  if (!live) {
    return {
      ok: false, modelId, reason: 'digest_unknown',
      detail:
        `${modelId} reports no digest, so its weights cannot be matched against the ` +
        `approved ones. Integrity is unverifiable rather than broken.`,
    };
  }

  const approved = normaliseDigest(approval.modelDigest);
  const installed = normaliseDigest(live);
  if (approved !== installed) {
    return {
      ok: false, modelId, reason: 'digest_mismatch',
      detail:
        `${modelId} no longer matches the approved weights — approved ` +
        `${short(approved)}, installed ${short(installed)}. The tag has been repointed ` +
        `and the model must be requalified.`,
    };
  }

  return { ok: true, modelId, digest: installed };
}

/** Enough to identify, not enough to be mistaken for the whole digest. */
function short(d: string): string {
  const hex = d.replace(/^sha256:/, '');
  return hex.length > 16 ? `sha256:${hex.slice(0, 16)}…` : d;
}

/**
 * The single sentence a user should see for each refusal.
 *
 * Kept beside the verdicts rather than in the consumer, for the same reason the
 * capability answers use the authority's own sentence: one fact, one wording.
 */
export const INTEGRITY_REASON_TEXT: Record<IntegrityFailure, string> = {
  digest_mismatch:
    'the approved model\'s weights have changed on this server, so it must be requalified before it can be offered again',
  digest_unknown:
    'the installed model does not report a verifiable identity, so its approval cannot be confirmed',
  approval_unbound:
    'the existing approval does not name exact weights, so it must be reissued before it can be relied on',
  model_absent:
    'the approved model is not installed on this server',
};
