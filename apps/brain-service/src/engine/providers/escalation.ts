// Intelligent Provider Router — Slice 3: cloud-escalation control plane.
//
// The FIRST slice where cloud execution may become possible — and never as a
// generic "local failed → call cloud" switch. Escalation is offered only when a
// DEFINED failure reason applies, the policy permits external transfer, a cloud
// provider is eligible, and it is within budget. It is then APPROVAL-GATED (a
// separate, single-use approval) and runs exactly ONE attributed cloud attempt.
//
// Escalation is IMPOSSIBLE under `local-only` or privacy policies that prohibit
// external transfer, regardless of reason.
//
// © MigraTeck LLC.

import type { ExecutionPolicyId } from './executionPolicy.js';
import type { FleetSnapshot } from './fleetRegistry.js';
import type { ProviderCapabilities } from './types.js';

/** The ONLY reasons that qualify for cloud escalation. A merely imperfect but
 * valid local result never qualifies. */
export type EscalationReason = 'LOCAL_TIMEOUT' | 'LOCAL_MALFORMED_OUTPUT' | 'LOCAL_CONTEXT_LIMIT' | 'LOCAL_UNSUPPORTED_CAPABILITY';
export const ESCALATION_REASONS: readonly EscalationReason[] = ['LOCAL_TIMEOUT', 'LOCAL_MALFORMED_OUTPUT', 'LOCAL_CONTEXT_LIMIT', 'LOCAL_UNSUPPORTED_CAPABILITY'];

/** Policies that PROHIBIT external transfer — escalation is impossible under them. */
const EXTERNAL_PROHIBITED: ReadonlySet<ExecutionPolicyId> = new Set<ExecutionPolicyId>(['local-only', 'privacy-first']);

export interface LocalOutcome {
  /** Did any local model qualify for the request? */
  hadLocalModel: boolean;
  /** Did the local turn finish successfully or fail? Only meaningful if a model ran. */
  terminal: 'completed' | 'failed';
  /** The local model's final output (may be empty). */
  output: string;
  /** Error text if the local turn failed (used only for classification, not surfaced raw). */
  errorMessage?: string;
}

/** Classify a local coding outcome into a DEFINED escalation reason, or null when
 * nothing qualifies (a valid-but-imperfect result returns null). */
export function classifyLocalFailure(o: LocalOutcome): EscalationReason | null {
  if (!o.hadLocalModel) return 'LOCAL_UNSUPPORTED_CAPABILITY';
  if (o.terminal === 'failed') {
    const e = (o.errorMessage ?? '').toLowerCase();
    if (/context|maximum context|too many tokens|context length|token limit/.test(e)) return 'LOCAL_CONTEXT_LIMIT';
    if (/timeout|timed out|aborted|etimedout|deadline/.test(e)) return 'LOCAL_TIMEOUT';
    return 'LOCAL_MALFORMED_OUTPUT'; // failed with no usable result
  }
  // Completed: only an empty/whitespace result qualifies (no usable output).
  if (o.output.trim().length === 0) return 'LOCAL_MALFORMED_OUTPUT';
  return null; // valid result — imperfect does NOT qualify
}

export interface EscalationTarget {
  providerId: string;
  modelId: string;
}

export interface EscalationDecision {
  offered: boolean;
  reason: EscalationReason | null;
  target?: EscalationTarget;
  estCostUsd?: number;
  /** Why escalation was NOT offered (truthful; safe). */
  deniedReason?: string;
}

export interface EscalationEvalInput {
  policy: ExecutionPolicyId;
  reason: EscalationReason | null;
  fleet: FleetSnapshot;
  /** Required hard capabilities for the turn (must be met by the cloud target). */
  requiredCaps?: Partial<ProviderCapabilities>;
  /** Rough token estimate for cost. */
  estInputTokens: number;
  estOutputTokens: number;
  /** Per-request cloud budget ceiling (USD). */
  budgetCapUsd: number;
}

/** Decide whether escalation may be OFFERED. Never executes; purely a gate.
 * Fail-closed: any unmet condition yields offered=false with a truthful reason. */
export function evaluateEscalation(input: EscalationEvalInput): EscalationDecision {
  if (!input.reason) return { offered: false, reason: null, deniedReason: 'no defined escalation reason' };
  if (EXTERNAL_PROHIBITED.has(input.policy)) {
    return { offered: false, reason: input.reason, deniedReason: `policy '${input.policy}' prohibits external transfer` };
  }
  // Eligible cloud provider: enabled + credentialed + not unreachable + a default
  // model + satisfies the required hard capabilities.
  const caps = input.requiredCaps ?? {};
  const eligible = input.fleet.providers
    .filter((fp) => {
      const p = fp.provider;
      if (p.kind !== 'cloud' || !p.enabled || !p.hasCredential || p.health.status === 'unreachable' || !p.defaultModel) return false;
      const e = fp.effectiveCapabilities;
      if (caps.vision && !e.vision) return false;
      if (caps.tools && !e.tools) return false;
      if (caps.coding && !e.coding) return false;
      return true;
    })
    // Prefer higher priority cloud provider.
    .sort((a, b) => b.provider.priority - a.provider.priority);

  if (eligible.length === 0) return { offered: false, reason: input.reason, deniedReason: 'no eligible cloud provider' };
  const target = eligible[0]!.provider;
  const estCostUsd = estimateCostUsd(target.cost, input.estInputTokens, input.estOutputTokens);
  if (estCostUsd > input.budgetCapUsd) {
    return { offered: false, reason: input.reason, deniedReason: `estimated cost $${estCostUsd.toFixed(4)} exceeds cloud budget cap $${input.budgetCapUsd.toFixed(2)}` };
  }
  return { offered: true, reason: input.reason, target: { providerId: target.id, modelId: target.defaultModel! }, estCostUsd };
}

export function estimateCostUsd(cost: { inputPer1M?: number; outputPer1M?: number } | undefined, inTok: number, outTok: number): number {
  const inP = cost?.inputPer1M ?? 0;
  const outP = cost?.outputPer1M ?? 0;
  return (inTok / 1_000_000) * inP + (outTok / 1_000_000) * outP;
}
