/*
 * MIGRA FAMILY -> BACKEND, resolved against governance at request time.
 *
 * The catalog says what a family REQUIRES. This says what — if anything —
 * currently satisfies that, by asking the live registry and the qualification
 * store. Keeping the two apart is the point: a `family -> model` table would be
 * a UI constant pretending to be governance, and would go stale the moment a
 * model was qualified, retired, or found wanting.
 *
 * UNAVAILABLE IS A REAL ANSWER. When nothing qualified satisfies a family, this
 * returns `available: false` with a reason. It never substitutes something
 * weaker and keeps the label: a user who picked Migra Vision and silently got a
 * non-vision model has been lied to in the most expensive possible way.
 */

import {
  MIGRA_FAMILY_IDS,
  MIGRA_MODEL_FAMILIES,
  type MigraFamilyResolution,
  type MigraModelFamily,
  type MigraModelFamilyId,
  type MigraProductSurface,
} from '@migrapilot/shared-types/model-families';

import type { ModelDescriptor } from './modelRegistry.js';

const TIER_ORDER = { fast: 0, balanced: 1, deep: 2 } as const;

/** A durable governed decision, as the qualification store reports it. */
export interface GovernedDecision {
  qualified: boolean;
  modelId: string | null;
}

export interface ResolveDeps {
  /** Everything the provider currently offers. */
  models: readonly ModelDescriptor[];
  /** Durable decision for a governed capability id, when one exists. */
  governedDecision?: (capability: string) => GovernedDecision | undefined;
  /** Models holding an approved grant for a task class. Empty = none approved. */
  approvedForTaskClass?: (taskClass: string) => readonly string[];
  /**
   * Can this model actually RUN under the server's current execution policy?
   *
   * Being listed by the provider is not the same as being runnable. The registry
   * surfaces Ollama's cloud-hosted models even while the effective policy is
   * local-only, and offering one of those is fake readiness: the family looks
   * available and every turn fails. Defaults to permissive, but the route passes
   * a real predicate — and it fails CLOSED, because an excluded usable model is
   * a smaller error than an offered unusable one.
   */
  executable?: (model: ModelDescriptor) => boolean;
  /**
   * Is this model ACCEPTABLE to the router that will actually run the turn?
   *
   * The catalog must be exactly as strict as execution. It was not: the resolver
   * matched on capability and tier alone and named a model the router then
   * refused for lacking an approved qualification state, so the selector
   * advertised one backend while every turn ran another. A catalog that predicts
   * a different answer than the router gives is worse than no catalog, because
   * it is confidently wrong.
   */
  routerAccepts?: (model: ModelDescriptor) => boolean;
}

/**
 * Does this model meet the family's hard requirements?
 *
 * Exported so the floor logic stays directly testable: the audit gate short-
 * circuits BLOCKED/INTENT families before resolution reaches here, which would
 * otherwise leave tier and context floors provable only for families that happen
 * to be live today.
 */
export function meetsRequirements(model: ModelDescriptor, family: MigraModelFamily): boolean {
  const req = family.requirements;
  for (const cap of req.capabilities) {
    if (!model.capabilities[cap]) return false;
  }
  if (TIER_ORDER[model.tier] < TIER_ORDER[req.minTier]) return false;
  if (req.minContextTokens && (model.contextLength ?? 0) < req.minContextTokens) return false;
  return true;
}

/**
 * Choose from the acceptable set according to the family's own intent.
 *
 * `minTier` is a floor, so "meets the floor" leaves a range — and the right end
 * of that range differs per family. Migra Swift promises speed and must take the
 * SMALLEST model that clears its floor; Migra Logic promises depth and must take
 * the largest. Sorting everything by size served Swift a 120B model.
 */
function pickPreferred(candidates: ModelDescriptor[], family: MigraModelFamily): ModelDescriptor | undefined {
  const dir = family.requirements.prefer === 'fastest' ? 1 : -1;
  return candidates
    .slice()
    .sort((a, b) => dir * (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || dir * ((a.paramCount ?? 0) - (b.paramCount ?? 0)))[0];
}

/**
 * Resolve one family.
 *
 * Order matters. A durable governed decision WINS whenever the family names a
 * governed capability, because a human approved that exact model for that exact
 * capability — capability flags are a discovery hint, a decision is authority.
 */
export function resolveFamily(id: MigraModelFamilyId, deps: ResolveDeps): MigraFamilyResolution {
  const family = MIGRA_MODEL_FAMILIES[id];
  const req = family.requirements;

  // 1 — a governed capability decision is the strongest possible basis.
  if (req.governedCapability) {
    const decision = deps.governedDecision?.(req.governedCapability);
    if (!decision || !decision.qualified || !decision.modelId) {
      return {
        family: id,
        available: false,
        governed: false,
        unavailableReason: `no approved model for ${req.governedCapability}`,
        basis: req.governedCapability,
      };
    }
    // The decision names a model; it must still be installed AND runnable.
    // A governed decision names the model explicitly, so the router admits it by
    // name — routerAccepts is deliberately NOT applied here.
    const present = deps.models.some(
      (m) => m.id === decision.modelId && (deps.executable?.(m) ?? true),
    );
    if (!present) {
      return {
        family: id,
        available: false,
        governed: true,
        unavailableReason: `the approved model for ${req.governedCapability} is not installed`,
        basis: req.governedCapability,
      };
    }
    return {
      family: id,
      available: true,
      governed: true,
      selectedBackend: decision.modelId,
      basis: req.governedCapability,
    };
  }

  // 2 — otherwise, a task-class grant is the next strongest basis.
  if (req.taskClasses?.length && deps.approvedForTaskClass) {
    for (const taskClass of req.taskClasses) {
      const approved = deps.approvedForTaskClass(taskClass);
      /*
       * routerAccepts is deliberately NOT applied to a granted model.
       *
       * A measured task-class grant is a governance decision of the same kind as
       * a durable capability approval, and the caller passes it to the router as
       * `governedApproval`, which admits it BY NAME. Applying the generic
       * "must be manifest-approved" rule here vetoed a model the router would
       * happily run — it made Migra Forge read as unavailable immediately after
       * it had been proven executing a real multi-tool workload.
       */
      const usable = deps.models.filter(
        (m) => approved.includes(m.id) && meetsRequirements(m, family) && (deps.executable?.(m) ?? true),
      );
      if (usable.length) {
        const best = pickPreferred(usable, family)!;
        return {
          family: id,
          available: true,
          governed: true,
          selectedBackend: best.id,
          basis: `grant:${taskClass}`,
        };
      }
    }
  }

  // 3 — capability + tier only. Honest, and honestly labelled UNGOVERNED, so a
  // surface can show that this family rests on no approval decision.
  const candidates = deps.models.filter(
    (m) => meetsRequirements(m, family) && (deps.executable?.(m) ?? true) && (deps.routerAccepts?.(m) ?? true),
  );
  if (!candidates.length) {
    return {
      family: id,
      available: false,
      governed: false,
      unavailableReason: `no installed model meets ${family.displayName}'s requirements`,
    };
  }
  const best = pickPreferred(candidates, family)!;
  return {
    family: id,
    available: true,
    governed: false,
    selectedBackend: best.id,
    basis: 'capability-match (ungoverned)',
  };
}

/** Resolve everything a surface may offer. */
export function resolveFamiliesForSurface(
  surface: MigraProductSurface,
  deps: ResolveDeps,
): MigraFamilyResolution[] {
  return MIGRA_FAMILY_IDS.filter((id) => MIGRA_MODEL_FAMILIES[id].surfaces.includes(surface)).map((id) =>
    resolveFamily(id, deps),
  );
}
