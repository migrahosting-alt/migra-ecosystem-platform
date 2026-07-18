// Intelligent Provider Router — Slice 1: execution policy model + dry-run engine.
//
// The seven execution policies as declarative definitions, plus a PolicyEngine
// that produces a TRUTHFUL, INSPECTABLE selection PLAN over a fleet snapshot. In
// Slice 1 this is DRY-RUN ONLY: the plan is never executed and no routing changes.
// It is the foundation Slice 2 will use to actually route.
//
// © MigraTeck LLC.

import type { ModelDescriptor, ModelTier } from '../modelRegistry.js';
import type { ProviderKind } from './types.js';
import type { FleetProvider, FleetSnapshot } from './fleetRegistry.js';

export type ExecutionPolicyId =
  | 'auto'
  | 'local-first'
  | 'local-only'
  | 'cloud-first'
  | 'best-quality'
  | 'lowest-cost'
  | 'privacy-first'
  | 'custom';

export interface ExecutionPolicyDef {
  id: ExecutionPolicyId;
  displayName: string;
  description: string;
}

export const EXECUTION_POLICIES: Record<ExecutionPolicyId, ExecutionPolicyDef> = {
  auto: { id: 'auto', displayName: 'Auto', description: 'Prefer local when it can satisfy the request; consider cloud otherwise.' },
  'local-first': { id: 'local-first', displayName: 'Local First', description: 'Rank local providers above cloud; cloud only as lower-ranked fallback.' },
  'local-only': { id: 'local-only', displayName: 'Local Only', description: 'Use local providers exclusively; cloud is excluded.' },
  'cloud-first': { id: 'cloud-first', displayName: 'Cloud First', description: 'Rank cloud providers above local.' },
  'best-quality': { id: 'best-quality', displayName: 'Best Quality', description: 'Rank by capability + model tier, regardless of location.' },
  'lowest-cost': { id: 'lowest-cost', displayName: 'Lowest Cost', description: 'Rank by lowest estimated cost; local (free) wins ties.' },
  'privacy-first': { id: 'privacy-first', displayName: 'Privacy First', description: 'Keep data on-device; external providers excluded without explicit consent.' },
  custom: { id: 'custom', displayName: 'Custom', description: 'Operator-defined weighting (configured in a later slice; uses Auto defaults for now).' },
};

export const DEFAULT_POLICY: ExecutionPolicyId = 'auto';

export function isExecutionPolicyId(v: string): v is ExecutionPolicyId {
  return v in EXECUTION_POLICIES;
}

/** What a turn needs. Hard flags exclude a provider that cannot satisfy them;
 * soft flags only bias ranking. `consentExternal` is required for external
 * providers under the privacy-first policy. */
export interface PlanHints {
  needsChat?: boolean; // default true
  needsVision?: boolean;
  needsTools?: boolean;
  needsEmbedding?: boolean;
  preferCoding?: boolean;
  needsReasoning?: boolean;
  tier?: ModelTier;
  consentExternal?: boolean;
}

export interface PlanCandidate {
  providerId: string;
  providerKind: ProviderKind;
  modelId?: string;
  score: number;
  reasons: string[];
}

export interface PlanExclusion {
  providerId: string;
  reason: string;
}

export interface SelectionPlan {
  policy: ExecutionPolicyId;
  /** Always true in Slice 1 — the plan is never executed. */
  dryRun: true;
  chosen: PlanCandidate | null;
  ranked: PlanCandidate[];
  excluded: PlanExclusion[];
  notes: string[];
}

const TIER_RANK: Record<ModelTier, number> = { fast: 0, balanced: 1, deep: 2 };

/** Best discovered model on a provider for the hints (or undefined). Honors hard
 * capability requirements against the MODEL, then scores tier proximity + coding/
 * reasoning bias. */
function bestModel(fp: FleetProvider, hints: PlanHints): ModelDescriptor | undefined {
  const want = hints.tier ?? 'balanced';
  const eligible = fp.models.filter(
    (m) =>
      (!hints.needsVision || m.capabilities.vision) &&
      (!hints.needsTools || m.capabilities.tools) &&
      (!hints.needsEmbedding || m.capabilities.embedding) &&
      (hints.needsEmbedding ? m.capabilities.embedding : m.capabilities.chat),
  );
  if (eligible.length === 0) return undefined;
  return eligible
    .map((m) => ({ m, s: -Math.abs(TIER_RANK[m.tier] - TIER_RANK[want]) + (hints.preferCoding && m.capabilities.coding ? 0.5 : 0) + (hints.needsReasoning && m.capabilities.reasoning ? 0.5 : 0) }))
    .sort((a, b) => b.s - a.s || a.m.id.localeCompare(b.m.id))[0]!.m;
}

export class PolicyEngine {
  /** Produce a dry-run selection plan. Never executes; never issues a completion. */
  plan(policy: ExecutionPolicyId, hints: PlanHints, fleet: FleetSnapshot): SelectionPlan {
    const notes: string[] = [];
    const excluded: PlanExclusion[] = [];
    const needsChat = hints.needsChat ?? true;
    const effectivePolicy: ExecutionPolicyId = policy === 'custom' ? 'auto' : policy;
    if (policy === 'custom') notes.push('custom policy uses Auto defaults until the Slice 5 UI config lands.');

    const survivors: FleetProvider[] = [];
    for (const fp of fleet.providers) {
      const p = fp.provider;
      const eff = fp.effectiveCapabilities;
      // Fail-closed exclusions, most fundamental first.
      if (!p.enabled) { excluded.push({ providerId: p.id, reason: 'provider disabled' }); continue; }
      if (p.health.status === 'unreachable') { excluded.push({ providerId: p.id, reason: 'provider unreachable' }); continue; }
      if (p.credentialEnv && !p.hasCredential) { excluded.push({ providerId: p.id, reason: 'credential absent' }); continue; }
      // Hard capability requirements against effective capabilities.
      if (needsChat && !eff.chat && !hints.needsEmbedding) { excluded.push({ providerId: p.id, reason: 'no chat capability' }); continue; }
      if (hints.needsVision && !eff.vision) { excluded.push({ providerId: p.id, reason: 'no vision capability' }); continue; }
      if (hints.needsTools && !eff.tools) { excluded.push({ providerId: p.id, reason: 'no tools capability' }); continue; }
      if (hints.needsEmbedding && !eff.embedding) { excluded.push({ providerId: p.id, reason: 'no embedding capability' }); continue; }
      // Policy-specific exclusions.
      if (effectivePolicy === 'local-only' && p.kind === 'cloud') { excluded.push({ providerId: p.id, reason: 'policy: local-only excludes cloud' }); continue; }
      if (effectivePolicy === 'privacy-first' && p.dataLocality === 'external' && !hints.consentExternal) { excluded.push({ providerId: p.id, reason: 'policy: privacy-first excludes external without consent' }); continue; }
      survivors.push(fp);
    }

    const ranked = survivors
      .map((fp) => this.score(effectivePolicy, fp, hints))
      // Priority is folded into the score; id is a deterministic final tie-break.
      .sort((a, b) => b.score - a.score || a.providerId.localeCompare(b.providerId));

    if (ranked.length === 0) notes.push('no eligible provider under this policy and request.');
    return { policy, dryRun: true, chosen: ranked[0] ?? null, ranked, excluded, notes };
  }

  private score(policy: ExecutionPolicyId, fp: FleetProvider, hints: PlanHints): PlanCandidate {
    const p = fp.provider;
    const eff = fp.effectiveCapabilities;
    const isLocal = p.kind === 'local';
    const priorityNorm = p.priority / 100;
    const avgCost = ((p.cost?.inputPer1M ?? 0) + (p.cost?.outputPer1M ?? 0)) / 2;
    const costScore = 1 / (1 + avgCost); // local (0) → 1
    const bm = bestModel(fp, hints);
    const tierScore = bm ? 1 - Math.abs(TIER_RANK[bm.tier] - TIER_RANK[hints.tier ?? 'balanced']) / 2 : 0.5;
    const soft = (hints.preferCoding && eff.coding ? 0.5 : 0) + (hints.needsReasoning && eff.reasoning ? 0.5 : 0);
    const reasons: string[] = [];
    let score = 0;

    switch (policy) {
      case 'local-first':
        score = (isLocal ? 2 : 0) + priorityNorm + 0.5 * soft + 0.3 * tierScore;
        reasons.push(isLocal ? 'local preferred' : 'cloud fallback (ranked below local)');
        break;
      case 'cloud-first':
        score = (!isLocal ? 2 : 0) + priorityNorm + 0.5 * soft + 0.3 * tierScore;
        reasons.push(!isLocal ? 'cloud preferred' : 'local fallback (ranked below cloud)');
        break;
      case 'local-only':
        score = priorityNorm + soft + tierScore;
        reasons.push('local-only pool');
        break;
      case 'best-quality':
        score = 2 * tierScore + soft + priorityNorm + (!isLocal ? 0.5 : 0);
        reasons.push(bm ? `best model tier: ${bm.tier}` : 'declared capabilities (no discovered model yet)');
        break;
      case 'lowest-cost':
        score = 3 * costScore + 0.3 * tierScore + 0.2 * soft;
        reasons.push(avgCost === 0 ? 'no marginal cost (local)' : `est. avg cost $${avgCost}/1M`);
        break;
      case 'privacy-first':
        score = (p.dataLocality === 'on-device' ? 2 : 0) + priorityNorm + soft + tierScore;
        reasons.push(p.dataLocality === 'on-device' ? 'on-device data locality' : 'external (consented)');
        break;
      case 'auto':
      default:
        score = (isLocal ? 1.5 : 0) + priorityNorm + soft + tierScore;
        reasons.push(isLocal ? 'auto: local satisfies the request' : 'auto: cloud considered');
        break;
    }
    if (soft > 0) reasons.push('capability match: ' + [hints.preferCoding && eff.coding ? 'coding' : '', hints.needsReasoning && eff.reasoning ? 'reasoning' : ''].filter(Boolean).join('+'));
    if (!bm && fp.models.length === 0) reasons.push('no discovered models; declared capabilities used');
    return { providerId: p.id, providerKind: p.kind, modelId: bm?.id, score: round(score), reasons };
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
