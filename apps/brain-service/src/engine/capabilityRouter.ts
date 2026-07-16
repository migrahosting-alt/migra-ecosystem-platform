/**
 * MigraAI Engine — Capability Router.
 *
 * Chooses the concrete model for a turn from the live {@link ModelRegistry},
 * driven by REQUIRED CAPABILITIES (vision, tools, embedding, reasoning, coding)
 * and a size tier (fast / balanced / deep) — not by static env vars. This is the
 * "the engine decides, nobody above knows" core: clients describe what the turn
 * needs; the router returns which model satisfies it and why.
 *
 * Selection is deterministic and explainable: hard capability filters first, then
 * a transparent score (tier match + capability bonuses + a small size tie-break),
 * then a documented fallback so a turn is never left without a model when any
 * chat model exists.
 */

import type { ModelDescriptor, ModelRegistry, ModelTier } from './modelRegistry.js';

export interface RouteSpec {
  /** Hard requirements — a chosen model MUST satisfy every true flag. */
  needsVision?: boolean;
  needsTools?: boolean;
  needsEmbedding?: boolean;
  /** Soft preferences — bias selection but never exclude. */
  needsReasoning?: boolean;
  preferCoding?: boolean;
  /** Desired size tier. Absent = 'balanced'. */
  tier?: ModelTier;
  /** Explicit model id override — used verbatim if present in the registry. */
  model?: string;
  /** Qualification gating. `production` (default) serves only approved models when
   * `enforce` is on; `evaluation` serves any non-rejected model (for benchmarking
   * through the engine). Rejected models are NEVER served in either mode. */
  mode?: 'production' | 'evaluation';
  /** Enforce approved-only in production. Off preserves pre-qualification
   * behavior (any non-rejected model is eligible). */
  enforce?: boolean;
}

export interface RouteDecision {
  model: ModelDescriptor;
  reason: string;
  /** Ranked alternatives (excluding the winner), best-first, for transparency. */
  alternatives: string[];
  /** Full eligible set, best-first (winner included) — used by the engine to fail
   * over to the next capable model when a completion fails (e.g. a model that is
   * advertised but can't actually load). */
  ranked: ModelDescriptor[];
}

const TIER_RANK: Record<ModelTier, number> = { fast: 0, balanced: 1, deep: 2 };

/** Resolve a {@link RouteSpec} to a concrete model, or `null` when no model in the
 * registry can satisfy the hard requirements (e.g. embeddings requested but no
 * embedding model is installed). */
export async function selectModel(
  registry: ModelRegistry,
  spec: RouteSpec,
  now = Date.now(),
): Promise<RouteDecision | null> {
  const catalog = await registry.list(false, now);
  if (catalog.length === 0) return null;

  // Explicit override wins when it exists and meets hard requirements.
  if (spec.model) {
    const exact = catalog.find((m) => m.id === spec.model);
    if (exact && satisfiesHard(exact, spec)) {
      return { model: exact, reason: `explicit model "${exact.id}"`, alternatives: [], ranked: [exact] };
    }
  }

  const wantTier = spec.tier ?? 'balanced';
  const eligible = catalog.filter((m) => satisfiesHard(m, spec));
  if (eligible.length === 0) {
    return null;
  }

  const scored = eligible
    .map((m) => ({ m, score: score(m, spec, wantTier) }))
    .sort((a, b) => b.score - a.score || (b.m.paramCount ?? 0) - (a.m.paramCount ?? 0));

  const top = scored[0];
  if (!top) return null;
  const winner = top.m;
  const ranked = scored.map((s) => s.m);
  return {
    model: winner,
    reason: explain(winner, spec, wantTier),
    alternatives: ranked.slice(1, 4).map((m) => m.id),
    ranked,
  };
}

function satisfiesHard(m: ModelDescriptor, spec: RouteSpec): boolean {
  // Qualification gate first — a rejected (failed) OR deprecated (retired/
  // superseded) model is never served in ANY mode, so a retired model can never
  // silently return as a default or failover target. Enforced production serves
  // only approved models; evaluation mode serves any still-eligible model so
  // unqualified candidates can be benchmarked through the engine.
  const state = m.qualification?.state;
  if (state === 'rejected' || state === 'deprecated') return false;
  if (spec.enforce && spec.mode !== 'evaluation' && state !== 'approved') return false;

  if (spec.needsEmbedding) return m.capabilities.embedding;
  // Non-embedding turns need a chat-capable model.
  if (!m.capabilities.chat) return false;
  if (spec.needsVision && !m.capabilities.vision) return false;
  if (spec.needsTools && !m.capabilities.tools) return false;
  return true;
}

function score(m: ModelDescriptor, spec: RouteSpec, wantTier: ModelTier): number {
  let s = 0;
  // Tier proximity is the primary axis (closer = better).
  s -= Math.abs(TIER_RANK[m.tier] - TIER_RANK[wantTier]) * 10;
  // Soft preferences.
  if (spec.needsReasoning && m.capabilities.reasoning) s += 6;
  if (spec.preferCoding && m.capabilities.coding) s += 6;
  // Prefer tool-capable models slightly when tools weren't required but available.
  if (!spec.needsTools && m.capabilities.tools) s += 1;
  // Tiny size tie-break so the ordering is stable and intent-aligned.
  if (m.paramCount != null) {
    s += wantTier === 'deep' ? m.paramCount * 0.05 : -m.paramCount * 0.02;
  }
  return s;
}

function explain(m: ModelDescriptor, spec: RouteSpec, wantTier: ModelTier): string {
  const bits: string[] = [`tier=${m.tier} (wanted ${wantTier})`];
  if (spec.needsVision) bits.push('vision required');
  if (spec.needsTools) bits.push('tools required');
  if (spec.needsEmbedding) bits.push('embedding required');
  if (spec.needsReasoning && m.capabilities.reasoning) bits.push('reasoning-capable');
  if (spec.preferCoding && m.capabilities.coding) bits.push('coding-capable');
  return `selected ${m.id} [${bits.join(', ')}]`;
}

/** Map the legacy fast/balanced/deep intent from an assortment of hints so old
 * callers (feature/profile) and new callers (explicit tier) both work. */
export function tierFromHints(hints: { tier?: string; profile?: string; feature?: string }): ModelTier {
  const t = (hints.tier ?? '').toLowerCase();
  if (t === 'fast' || t === 'balanced' || t === 'deep') return t;
  switch ((hints.profile ?? '').toLowerCase()) {
    case 'cheap':
    case 'local':
      return 'fast';
    case 'premium':
      return 'deep';
    case 'default':
      return 'balanced';
  }
  switch ((hints.feature ?? '').toLowerCase()) {
    case 'commit':
    case 'explain':
      return 'fast';
    case 'review':
    case 'fix':
      return 'deep';
    default:
      return 'balanced';
  }
}
