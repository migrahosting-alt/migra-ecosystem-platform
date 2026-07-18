// Intelligent Provider Router — Slice 2: local-first coding selection.
//
// Turns a policy plan into a concrete LOCAL model choice for a coding turn. Slice 2
// executes LOCALLY ONLY: it selects the highest-ranked eligible local provider/
// model under the active policy, and when the policy would prefer cloud (or no
// local model qualifies) it records `fallbackRecommended` WITHOUT invoking any
// cloud provider. Automatic paid fallback is deferred to Slice 3 (escalation +
// consent). This layer never issues a completion — it only selects.
//
// © MigraTeck LLC.

import type { ModelDescriptor, ModelTier } from '../modelRegistry.js';
import type { FleetRegistry, FleetProvider } from './fleetRegistry.js';
import { PolicyEngine, type ExecutionPolicyId, type PlanHints, type SelectionPlan } from './executionPolicy.js';

export interface LocalRoutingDeps {
  fleet: FleetRegistry;
  engine: PolicyEngine;
  policy: ExecutionPolicyId;
}

export interface LocalRoutingDecision {
  policy: ExecutionPolicyId;
  /** Full dry-run plan (transparency). */
  plan: SelectionPlan;
  /** The chosen LOCAL model, or null when no local model qualifies. */
  localModel: ModelDescriptor | null;
  localProviderId: string | null;
  /** Local candidates in preference order (for local-only failover). */
  rankedLocalModels: ModelDescriptor[];
  /** True when the active policy would prefer cloud, or no local model qualifies.
   * Advisory only in Slice 2 — no cloud is invoked. */
  fallbackRecommended: boolean;
  fallbackReasons: string[];
}

const TIER_RANK: Record<ModelTier, number> = { fast: 0, balanced: 1, deep: 2 };

/** Rank a local provider's eligible models for the hints (best first), honoring
 * hard capability requirements against the MODEL. Mirrors the policy engine's
 * per-model scoring so the top pick is consistent with the plan. */
export function rankLocalModels(localProviders: FleetProvider[], hints: PlanHints): ModelDescriptor[] {
  const want = hints.tier ?? 'balanced';
  const eligible: ModelDescriptor[] = [];
  for (const fp of localProviders) {
    for (const m of fp.models) {
      if (hints.needsVision && !m.capabilities.vision) continue;
      if (hints.needsTools && !m.capabilities.tools) continue;
      if (hints.needsEmbedding && !m.capabilities.embedding) continue;
      if (!(hints.needsEmbedding ? m.capabilities.embedding : m.capabilities.chat)) continue;
      eligible.push(m);
    }
  }
  return eligible
    .map((m) => ({ m, s: -Math.abs(TIER_RANK[m.tier] - TIER_RANK[want]) + (hints.preferCoding && m.capabilities.coding ? 0.5 : 0) + (hints.needsReasoning && m.capabilities.reasoning ? 0.5 : 0) }))
    .sort((a, b) => b.s - a.s || a.m.id.localeCompare(b.m.id))
    .map((x) => x.m);
}

/** Select the local coding model under the active policy. Never invokes cloud. */
export async function selectLocalCoding(deps: LocalRoutingDeps, hints: PlanHints): Promise<LocalRoutingDecision> {
  const snapshot = await deps.fleet.snapshot();
  const plan = deps.engine.plan(deps.policy, hints, snapshot);

  const localProviders = snapshot.providers.filter((fp) => fp.provider.kind === 'local' && fp.provider.enabled && fp.provider.health.status !== 'unreachable');
  const rankedLocalModels = rankLocalModels(localProviders, hints);
  const localModel = rankedLocalModels[0] ?? null;
  const localProviderId = localModel
    ? localProviders.find((fp) => fp.models.some((m) => m.id === localModel.id))?.provider.id ?? null
    : null;

  const fallbackReasons: string[] = [];
  // The plan's top choice being a cloud provider means the active policy prefers
  // cloud for this request — recorded, never acted on in Slice 2.
  if (plan.chosen && plan.chosen.providerKind === 'cloud') {
    fallbackReasons.push(`active policy '${deps.policy}' ranks a cloud provider first (cloud not invoked in this slice)`);
  }
  if (!localModel) {
    fallbackReasons.push('no eligible local model for this request');
  }

  return {
    policy: deps.policy,
    plan,
    localModel,
    localProviderId,
    rankedLocalModels,
    fallbackRecommended: fallbackReasons.length > 0,
    fallbackReasons,
  };
}
