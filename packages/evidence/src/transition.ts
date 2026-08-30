/**
 * The status state machine.
 *
 * TRANSITIONS ARE VALIDATED BY CODE, NOT CONVENTION. A policy document can be
 * forgotten mid-task by a tired human or an agent optimising for a finished-
 * sounding answer. A function that returns `REFUSED` cannot.
 *
 * The single rule everything else serves: **missing evidence blocks promotion
 * and is never read as a pass.** Every refusal below is a case where something
 * was absent, disagreed with itself, or had never been shown capable of failing.
 */

import {
  TERMINAL_STATUSES,
  type ClaimStatus,
  type Evidence,
} from './evidence.js';

/** Which statuses may follow which. Anything not listed is not a legal move. */
const ALLOWED: Record<ClaimStatus, readonly ClaimStatus[]> = {
  /*
   * INTENT → PROVEN_LIVE IS LEGAL, and that is deliberate. Forcing a stop at
   * OBSERVED first adds ceremony without safety: the evidence check is the
   * substantive gate, and it applies either way. Blocking the direct move meant
   * a caller holding complete evidence got `illegal_transition` — a refusal that
   * hides the real reason and teaches people to route around the machine.
   * Surfaced by the adversarial suite, which expected a refusal about samples
   * and got one about transitions.
   */
  INTENT: ['OBSERVED', 'PARTIAL', 'PROVEN_LIVE', 'BLOCKED', 'REFUSED', 'WITHDRAWN', 'SUPERSEDED'],
  OBSERVED: ['PARTIAL', 'PROVEN_LIVE', 'BLOCKED', 'REFUSED', 'WITHDRAWN', 'SUPERSEDED'],
  PARTIAL: ['OBSERVED', 'PROVEN_LIVE', 'BLOCKED', 'REFUSED', 'WITHDRAWN', 'SUPERSEDED'],
  /*
   * PROVEN_LIVE IS NOT PERMANENT. A proven claim can still be disproven later,
   * or replaced by a better one. What it cannot do is quietly slide back to
   * OBSERVED — reopening it requires saying so, as WITHDRAWN or SUPERSEDED.
   */
  PROVEN_LIVE: ['WITHDRAWN', 'SUPERSEDED'],
  REFUSED: ['OBSERVED', 'PARTIAL', 'PROVEN_LIVE', 'BLOCKED', 'WITHDRAWN', 'SUPERSEDED'],
  BLOCKED: ['INTENT', 'OBSERVED', 'PARTIAL', 'REFUSED', 'WITHDRAWN', 'SUPERSEDED'],
  WITHDRAWN: [],
  SUPERSEDED: [],
};

export interface Refusal {
  /** Short machine-readable cause. */
  code: string;
  /** What was missing or contradictory, in words a person can act on. */
  reason: string;
}

export type TransitionResult =
  | { ok: true; status: ClaimStatus }
  | { ok: false; status: 'REFUSED'; refusals: Refusal[] };

/** How many independent runs a stochastic claim needs before it can be proven. */
export const DEFAULT_REPLICATION_THRESHOLD = 3;

export interface PromotionOptions {
  /** Override the replication bar for stochastic work. */
  replicationThreshold?: number;
  /**
   * Permit a divergence between requested and executed route/model.
   *
   * Exists so a deliberate, RECORDED fallback is expressible. It is not a way to
   * silence the check: the justification is stored on the claim, so "we ran
   * something else" stays visible instead of becoming invisible.
   */
  allowRouteDivergence?: { reason: string };
}

/**
 * Everything that must hold before a claim may be called PROVEN_LIVE.
 *
 * Returns every refusal rather than the first. A caller fixing one gap at a time
 * learns of the next only on the next attempt, which is how a two-line fix turns
 * into six round trips.
 */
export function checkProvenLive(
  evidence: Evidence,
  options: PromotionOptions = {},
): Refusal[] {
  const refusals: Refusal[] = [];
  const threshold = options.replicationThreshold ?? DEFAULT_REPLICATION_THRESHOLD;

  /* ── what actually ran ─────────────────────────────────────────────── */

  if (!evidence.executedRoute) {
    refusals.push({
      code: 'no_executed_route',
      reason: 'The route that actually executed was never recorded, so this proves nothing about the real path.',
    });
  }
  if (!evidence.runtimeRevision) {
    refusals.push({
      code: 'no_runtime_revision',
      reason: 'The revision that ran is unknown — the claim cannot be tied to a specific build.',
    });
  }

  /*
   * REQUESTED VERSUS EXECUTED. A silent substitution produces a real, reportable
   * result about something nobody asked for. It is the most convincing kind of
   * wrong answer, because everything about it looks like it worked.
   */
  const routeDiverged =
    evidence.requestedRoute !== null &&
    evidence.executedRoute !== null &&
    evidence.requestedRoute !== evidence.executedRoute;
  const modelDiverged =
    evidence.requestedModel !== null &&
    evidence.executedModel !== null &&
    evidence.requestedModel !== evidence.executedModel;

  if ((routeDiverged || modelDiverged) && !options.allowRouteDivergence) {
    refusals.push({
      code: 'route_or_model_divergence',
      reason: routeDiverged
        ? `Requested route ${evidence.requestedRoute} but ${evidence.executedRoute} executed.`
        : `Requested model ${evidence.requestedModel} but ${evidence.executedModel} executed.`,
    });
  }

  /* ── did anything actually get measured ────────────────────────────── */

  if (evidence.acceptanceChecks.length === 0) {
    refusals.push({
      code: 'no_acceptance_checks',
      reason: 'No acceptance checks were recorded. "It ran" is not "it did the requested thing".',
    });
  }

  /*
   * A NULL RESULT IS NOT MEASURED, AND NOT MEASURED IS NOT PASS. This is the
   * rule that stops "typecheck passed" with empty output from becoming proof.
   */
  const unmeasured = evidence.acceptanceChecks.filter((c) => c.passed === null);
  if (unmeasured.length > 0) {
    refusals.push({
      code: 'unmeasured_checks',
      reason: `Not measured, so not passed: ${unmeasured.map((c) => c.name).join(', ')}.`,
    });
  }

  const failed = evidence.acceptanceChecks.filter((c) => c.passed === false);
  if (failed.length > 0) {
    refusals.push({
      code: 'failed_checks',
      reason: `These checks failed: ${failed.map((c) => c.name).join(', ')}.`,
    });
  }

  /* ── enough samples to be a property of the system ─────────────────── */

  if (evidence.determinism === 'stochastic') {
    if (evidence.sampleCount < threshold) {
      refusals.push({
        code: 'insufficient_samples',
        reason: `Stochastic result with ${evidence.sampleCount} sample(s); ${threshold} required. One run is an anecdote.`,
      });
    }
  } else if (evidence.sampleCount < 1) {
    refusals.push({
      code: 'no_samples',
      reason: 'Declared deterministic but never actually executed.',
    });
  }

  /* ── has the verifier ever been shown to fail ──────────────────────── */

  if (evidence.controls.length === 0) {
    refusals.push({
      code: 'no_controls',
      reason: 'No negative control. A check nobody has seen fail is not evidence that anything passed.',
    });
  } else if (evidence.controls.some((c) => c.outcome === 'passed_unexpectedly')) {
    refusals.push({
      code: 'control_did_not_fail',
      reason: 'A control passed when it should have failed — the verifier cannot distinguish success from anything.',
    });
  } else if (evidence.controls.every((c) => c.outcome === 'not_run')) {
    refusals.push({
      code: 'controls_not_run',
      reason: 'Controls were declared but never run.',
    });
  }

  /* ── artefacts must be identified by content, not by name ──────────── */

  const unhashed = evidence.outputs.filter((o) => o.sha256 === null);
  if (unhashed.length > 0) {
    refusals.push({
      code: 'unhashed_outputs',
      reason: `Output exists but was never hashed: ${unhashed.map((o) => o.ref).join(', ')}. A filename is not the file.`,
    });
  }

  /* ── product claims need the product ───────────────────────────────── */

  if (evidence.productFacing && !evidence.liveProbe) {
    refusals.push({
      code: 'no_live_probe',
      reason: 'Product-facing claim with no live evidence. Passing tests are not a working feature.',
    });
  }

  return refusals;
}

/**
 * Attempt a transition.
 *
 * The ONLY way a claim changes status. Illegal moves and unmet promotion
 * requirements both come back as `REFUSED` with reasons attached, so a rejected
 * promotion is itself a recorded event rather than a silent no-op.
 */
export function transition(
  from: ClaimStatus,
  to: ClaimStatus,
  evidence: Evidence,
  options: PromotionOptions = {},
): TransitionResult {
  if (TERMINAL_STATUSES.includes(from)) {
    return {
      ok: false,
      status: 'REFUSED',
      refusals: [
        {
          code: 'terminal_state',
          reason: `${from} is terminal. Raise a new claim rather than reopening this one.`,
        },
      ],
    };
  }

  if (!ALLOWED[from].includes(to)) {
    return {
      ok: false,
      status: 'REFUSED',
      refusals: [{ code: 'illegal_transition', reason: `${from} → ${to} is not a legal transition.` }],
    };
  }

  /*
   * WITHDRAWN AND SUPERSEDED ARE ALWAYS AVAILABLE, and deliberately demand no
   * evidence. Retracting a claim must never be harder than making one — if it
   * were, wrong claims would survive on friction alone.
   */
  if (to === 'PROVEN_LIVE') {
    const refusals = checkProvenLive(evidence, options);
    if (refusals.length > 0) return { ok: false, status: 'REFUSED', refusals };
  }

  return { ok: true, status: to };
}
