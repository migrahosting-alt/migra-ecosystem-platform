/**
 * The compute allocator.
 *
 * FAIL-CLOSED, IN ONE SENTENCE: local when local is genuinely capable, a
 * qualified remote when it is not, and a REFUSAL when nothing qualifies. There
 * is no fourth branch, and in particular there is no "closest available" — a
 * job that asked for 48 GB and quietly got 24 GB produces a real, plausible,
 * wrong result, and that is the single most expensive failure this component
 * can have.
 *
 * THE DECISION IS EVIDENCE, EMITTED BEFORE ANYTHING IS PROVISIONED. "RunPod
 * L40S because the local 3090 has insufficient VRAM" must be a machine-checkable
 * claim, not a sentence in a log that nobody reads until the invoice arrives.
 * `decide()` returns the decision AND the evidence for it, and
 * `authorizeProvisioning()` refuses to spend money on a decision whose evidence
 * does not hold up.
 */

import {
  emptyEvidence,
  type Actor,
  type Evidence,
  type Refusal,
} from '@migrateck/evidence';
import {
  projectedCostUsd,
  satisfies,
  type AllocationDecision,
  type JobManifest,
  type LocalProbe,
  type RemoteCandidate,
} from './manifest.js';

export interface AllocationInput {
  manifest: JobManifest;
  localProbe: LocalProbe;
  /** Remote options, already priced. An empty list is a legitimate state. */
  candidates: RemoteCandidate[];
  actor: Actor;
}

export interface AllocationOutcome {
  decision: AllocationDecision;
  /**
   * The claim the allocator is making about its own decision.
   *
   * Produced whichever way the decision went, including refusals — a refusal is
   * a result worth being able to audit later, not silence.
   */
  evidence: Evidence;
}

/**
 * Choose where this job runs.
 *
 * Pure: it provisions nothing, spends nothing, and can be run as many times as
 * you like to inspect what it WOULD do.
 */
export function decide(input: AllocationInput): AllocationOutcome {
  const { manifest, localProbe, candidates, actor } = input;
  const refusals: Refusal[] = [];

  const localSufficient = localProbe.capable && satisfies(localProbe.available, manifest.required);

  /*
   * LOCAL FIRST, ALWAYS. Remote is the fallback, never the default — the cost
   * asymmetry is entirely one-directional, and a system that reaches for rented
   * GPUs when the local one would do is expensive in a way nobody notices until
   * it is habitual.
   */
  if (localSufficient) {
    const decision: AllocationDecision = {
      route: 'local',
      reason: `local satisfies ${manifest.required.vramGb}GB VRAM / ${manifest.required.ramGb}GB RAM / ${manifest.required.storageGb}GB disk`,
    };
    return { decision, evidence: decisionEvidence(manifest, decision, localProbe, actor) };
  }

  const localShortfall = !localProbe.capable
    ? (localProbe.reason ?? 'local runtime cannot perform this capability')
    : `local has ${localProbe.available.vramGb}GB VRAM, job needs ${manifest.required.vramGb}GB`;

  /*
   * QUALIFIED MEANS EVERY LINE OF THE REQUIREMENT, not the VRAM headline. A
   * candidate with enough VRAM and not enough disk fails halfway through, after
   * the money is spent and the inputs are transferred.
   */
  const qualified = candidates.filter((c) => satisfies(c.available, manifest.required));

  if (qualified.length === 0) {
    refusals.push({
      code: 'no_qualified_remote',
      reason: `${localShortfall}, and no remote candidate satisfies the requirement (${candidates.length} considered).`,
    });
    const decision: AllocationDecision = { route: 'refused', refusals };
    return { decision, evidence: decisionEvidence(manifest, decision, localProbe, actor) };
  }

  /*
   * WITHIN BUDGET, CHECKED BEFORE LAUNCH. A ceiling enforced after the fact is
   * an invoice, not a control.
   */
  const affordable = qualified.filter((c) => projectedCostUsd(c) <= manifest.maxCostUsd);
  if (affordable.length === 0) {
    const cheapest = [...qualified].sort((a, b) => projectedCostUsd(a) - projectedCostUsd(b))[0]!;
    refusals.push({
      code: 'over_cost_ceiling',
      reason: `cheapest qualified candidate ${cheapest.gpuType} projects $${projectedCostUsd(cheapest).toFixed(2)}, ceiling is $${manifest.maxCostUsd.toFixed(2)}.`,
    });
    const decision: AllocationDecision = { route: 'refused', refusals };
    return { decision, evidence: decisionEvidence(manifest, decision, localProbe, actor) };
  }

  /* And fast enough to be worth running at all. */
  const inTime = affordable.filter((c) => c.estimatedSeconds <= manifest.maxLatencySeconds);
  if (inTime.length === 0) {
    refusals.push({
      code: 'over_latency_budget',
      reason: `no affordable candidate finishes within ${manifest.maxLatencySeconds}s.`,
    });
    const decision: AllocationDecision = { route: 'refused', refusals };
    return { decision, evidence: decisionEvidence(manifest, decision, localProbe, actor) };
  }

  /*
   * Cheapest that qualifies. Not the largest, not the fastest: the requirement
   * is already the definition of "big enough", so paying past it buys nothing
   * the manifest asked for.
   */
  const candidate = [...inTime].sort((a, b) => projectedCostUsd(a) - projectedCostUsd(b))[0]!;
  const decision: AllocationDecision = {
    route: 'remote',
    candidate,
    reason: `${localShortfall}; ${candidate.gpuType} (${candidate.available.vramGb}GB) qualifies at $${projectedCostUsd(candidate).toFixed(2)}`,
  };
  return { decision, evidence: decisionEvidence(manifest, decision, localProbe, actor) };
}

/**
 * The allocator's claim about its own decision.
 *
 * Deliberately deterministic and non-product-facing: choosing a route is a pure
 * computation over probes, so replication proves nothing and there is no user
 * surface to probe. The control is what matters — it records that the decision
 * WOULD have gone elsewhere had the probe differed, which is the only way to
 * show the inputs actually drove the outcome.
 */
function decisionEvidence(
  manifest: JobManifest,
  decision: AllocationDecision,
  localProbe: LocalProbe,
  actor: Actor,
): Evidence {
  const chosen =
    decision.route === 'remote'
      ? `remote:${decision.candidate.gpuType}`
      : decision.route;

  return {
    ...emptyEvidence(
      `job ${manifest.jobId} routed to ${chosen}`,
      `ibridge.allocation.${manifest.capability}`,
      actor,
    ),
    /*
     * requestedRoute is NULL, deliberately. Nothing requested a route — choosing
     * one is this component's entire job, so recording a preference here and the
     * outcome below reads as a SUBSTITUTION to the evidence layer, which flags
     * exactly what it should: a route that changed behind someone's back.
     *
     * Caught by the acceptance suite, which refused a perfectly sound remote
     * decision for `route_or_model_divergence`. The check was right; the field
     * was being misused. The justification lives in `provenance`, where the
     * reason for the choice belongs.
     */
    requestedRoute: null,
    executedRoute: chosen,
    requestedModel: manifest.requestedModel,
    executedModel: manifest.requestedModel,
    provenance: decision.route === 'refused' ? decision.refusals.map((r) => r.reason).join('; ') : decision.reason,
    runtimeRevision: manifest.requestedRuntime,
    inputs: manifest.inputs,
    determinism: 'deterministic',
    sampleCount: 1,
    controls: [
      {
        name: 'requirement exceeds local capacity',
        outcome:
          localProbe.capable && satisfies(localProbe.available, manifest.required)
            ? 'not_run'
            : 'failed_as_expected',
      },
    ],
    acceptanceChecks: [
      {
        name: 'chosen worker satisfies every resource line',
        passed:
          decision.route === 'remote'
            ? satisfies(decision.candidate.available, manifest.required)
            : decision.route === 'local'
              ? satisfies(localProbe.available, manifest.required)
              : false,
      },
      {
        name: 'projected cost within ceiling',
        passed:
          decision.route === 'remote'
            ? projectedCostUsd(decision.candidate) <= manifest.maxCostUsd
            : true,
      },
    ],
    liveProbe: null,
    productFacing: false,
    knownLimits: ['decision only — proves nothing about execution'],
  };
}

/**
 * The gate in front of the money.
 *
 * Nothing expensive may be provisioned until the allocator's own claim survives
 * inspection. This is the point of emitting decision evidence before rather than
 * after: a decision that cannot be justified must not be actionable.
 *
 * TAKES THE MANIFEST rather than trusting the decision's own summary. The
 * evidence and the decision are produced by the same function, so a bug that
 * corrupted one would corrupt both — re-checking the candidate against the
 * original requirement is what makes this a gate and not an echo.
 */
export function authorizeProvisioning(
  outcome: AllocationOutcome,
  manifest: JobManifest,
): Refusal[] {
  const { decision, evidence } = outcome;

  if (decision.route === 'refused') return decision.refusals;
  if (decision.route === 'local') return [];

  const refusals: Refusal[] = [];

  for (const check of evidence.acceptanceChecks.filter((c) => c.passed !== true)) {
    refusals.push({
      code: 'decision_check_failed',
      reason: `allocator could not establish: ${check.name}`,
    });
  }

  if (!satisfies(decision.candidate.available, manifest.required)) {
    refusals.push({
      code: 'undersized_worker',
      reason: `candidate ${decision.candidate.gpuType} has ${decision.candidate.available.vramGb}GB VRAM; manifest requires ${manifest.required.vramGb}GB.`,
    });
  }

  if (projectedCostUsd(decision.candidate) > manifest.maxCostUsd) {
    refusals.push({
      code: 'over_cost_ceiling',
      reason: `projected $${projectedCostUsd(decision.candidate).toFixed(2)} exceeds ceiling $${manifest.maxCostUsd.toFixed(2)}.`,
    });
  }

  return refusals;
}
