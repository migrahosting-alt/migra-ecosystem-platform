/*
 * MIGRA MODELS v1 — the canonical user-facing model family catalog.
 *
 * ONE catalog, owned here because @migrapilot/shared-types is the only package
 * every surface already depends on: the Brain, the consumer, and the VS Code
 * extension. Six names hard-coded three times would be six aliases that drift,
 * which is the entire failure this file exists to prevent.
 *
 * THESE ARE PRODUCT IDENTITIES, NOT MODELS. A user picks "Migra Forge"; they do
 * not pick qwen2.5-coder:14b, and they must not be shown it in the ordinary
 * selector. Backend names stay internal, governed, and replaceable — swapping
 * the model behind a family is a governance decision, not a UI edit.
 *
 * THE MAPPING IS NOT DECLARED HERE, AND THAT IS THE POINT. Each family declares
 * what it REQUIRES — capabilities, a tier floor, a governed capability id or
 * task class. Resolution happens at request time against the live registry and
 * the qualification store, so a family cannot claim a model that governance has
 * not approved, and a newly qualified model is picked up without a code change.
 * A hard-coded `family -> model` table would be a UI constant wearing a
 * governance costume.
 *
 * READINESS IS COMPUTED, NEVER ASSERTED — and this file once broke its own rule.
 * It carried an `auditedStatus` per family (PROVEN_LIVE, PARTIAL, BLOCKED) and
 * the resolver GATED availability on it, so a hand-written literal decided what
 * the product could do. That is hard-coded operational truth: it goes stale
 * silently, and it cannot follow a qualification that changed five minutes ago.
 *
 * It is gone. What stays here is only what is genuinely stable — the six
 * identities, their product semantics, and the CAPABILITY each one requires.
 * Everything operational is resolved at runtime: which model satisfies a
 * capability, whether it is installed, whether it can run, and therefore whether
 * the family is available at all. Status belongs to evidence and governance, not
 * to a constant in a source file.
 */

/** Stable internal ids. These never change, even if a display name does. */
export type MigraModelFamilyId =
  | 'migra-core'
  | 'migra-logic'
  | 'migra-forge'
  | 'migra-swift'
  | 'migra-vision'
  | 'migra-atlas';

/** Where a family may be offered. A family can be right for one surface and wrong for another. */
export type MigraProductSurface = 'migrapilot-consumer' | 'vscode-extension';

export type MigraSpeedTier = 'fast' | 'balanced' | 'deep';

/** What a family needs from a backend before it may be resolved to one. */
export interface MigraFamilyRequirements {
  /** Registry capability flags that must ALL be true. */
  capabilities: Array<'chat' | 'vision' | 'tools' | 'reasoning' | 'coding'>;
  /** Lowest acceptable size/quality tier. */
  minTier: MigraSpeedTier;
  /** Minimum usable context window, when the family is defined by context. */
  minContextTokens?: number;
  /**
   * The governed capability this family answers under, when one exists.
   * Resolution consults the qualification store for this id — so the mapping
   * comes from a durable human decision, not from this file.
   */
  governedCapability?: string;
  /** Agent task classes this family is expected to serve, for grant lookup. */
  taskClasses?: string[];
  /**
   * Which end of the acceptable range to pick from.
   *
   * `minTier` is a FLOOR, not a target, so "strongest" and "fastest" are
   * genuinely different questions. Without this, Migra Swift — whose whole
   * promise is speed — resolved to the largest installed model simply because it
   * cleared the floor, which is the opposite of what the user asked for.
   */
  prefer: 'fastest' | 'strongest';
}

/**
 * What may happen when the preferred backend is unavailable.
 *
 * `none` means the family reports unavailable. Silently serving a weaker model
 * is forbidden: the user asked for a capability, and quietly downgrading it
 * while keeping the label is the lie this whole catalog is built to prevent.
 */
export type MigraFallbackPolicy =
  | { kind: 'none' }
  | { kind: 'qualified-only'; note: string };

export interface MigraModelFamily {
  id: MigraModelFamilyId;
  displayName: string;
  /** One line, in outcomes. Never mentions infrastructure. */
  tagline: string;
  description: string;
  requirements: MigraFamilyRequirements;
  surfaces: MigraProductSurface[];
  fallback: MigraFallbackPolicy;
  /** Recommended default for a surface with no explicit choice. */
  recommended?: boolean;
}

/*
 * The audit behind every status below was run on 2026-09-02 against the live
 * production Brain and the committed capability grants. Two things it found, and
 * they shape most of these statuses:
 *
 *   1. Qualification today covers VISION only. `vision.general` has a durable
 *      governed decision naming an exact digest; nothing else does.
 *   2. Agent work is governed separately by task-class grants, where only
 *      `typed-implementation` and `repository-diagnosis` carry approved local
 *      capability. Everything else is unapproved, cloud-tier (and cloud is
 *      disabled), or human-approval.
 *
 * So exactly one family can honestly claim PROVEN_LIVE today. That is the
 * correct outcome of an audit, not a shortfall in it.
 */
export const MIGRA_MODEL_FAMILIES: Record<MigraModelFamilyId, MigraModelFamily> = {
  'migra-core': {
    id: 'migra-core',
    displayName: 'Migra Core',
    tagline: 'Best for everyday work and general tasks',
    description: 'The balanced default for chat, general work and mixed tasks.',
    requirements: {
      capabilities: ['chat', 'tools'],
      minTier: 'balanced',
      prefer: 'fastest',
      governedCapability: 'chat.general',
    },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
    recommended: true,
  },

  'migra-logic': {
    id: 'migra-logic',
    displayName: 'Migra Logic',
    tagline: 'Best for complex reasoning and multi-step problems',
    description: 'Deeper reasoning for multi-step analysis, hard problems and planning.',
    requirements: {
      capabilities: ['chat', 'reasoning'],
      minTier: 'deep',
      prefer: 'strongest',
      governedCapability: 'reasoning.deep',
      taskClasses: ['patch-planning', 'dependency-analysis'],
    },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
  },

  'migra-forge': {
    id: 'migra-forge',
    displayName: 'Migra Forge',
    tagline: 'Best for coding and engineering',
    description: 'Coding and engineering: debugging, code generation, repository work and technical workflows.',
    requirements: {
      capabilities: ['chat', 'coding', 'tools'],
      minTier: 'balanced',
      prefer: 'strongest',
      taskClasses: ['typed-implementation', 'repository-diagnosis', 'multi-file-change', 'refactoring'],
    },
    surfaces: ['vscode-extension', 'migrapilot-consumer'],
    fallback: { kind: 'qualified-only', note: 'may drop to a smaller coder ONLY where that model holds an approved grant for the task class' },
  },

  'migra-swift': {
    id: 'migra-swift',
    displayName: 'Migra Swift',
    tagline: 'Fastest for quick and routine tasks',
    description: 'Fast, lightweight answers for quick and routine work.',
    requirements: {
      capabilities: ['chat'],
      minTier: 'fast',
      prefer: 'fastest',
      governedCapability: 'chat.fast',
    },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
  },

  'migra-vision': {
    id: 'migra-vision',
    displayName: 'Migra Vision',
    tagline: 'Best for images, mockups and visual analysis',
    description: 'Images and visual understanding: screenshots, mockups, photos, diagrams and visual reasoning.',
    requirements: {
      capabilities: ['chat', 'vision'],
      minTier: 'balanced',
      prefer: 'strongest',
      governedCapability: 'vision.general',
    },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
  },

  'migra-atlas': {
    id: 'migra-atlas',
    displayName: 'Migra Atlas',
    tagline: 'Best for long documents and large-context work',
    description: 'Long-context work: long conversations, large PDFs, large document sets and corpus-heavy analysis.',
    requirements: {
      capabilities: ['chat'],
      minTier: 'balanced',
      minContextTokens: 128_000,
      prefer: 'strongest',
      governedCapability: 'chat.long_context',
    },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
  },
};

/** Catalog revision. Bump when a family is added, removed, or its requirements change. */
export const MIGRA_MODEL_CATALOG_REVISION = '1.0.0';

export const MIGRA_FAMILY_IDS: readonly MigraModelFamilyId[] = Object.keys(
  MIGRA_MODEL_FAMILIES,
) as MigraModelFamilyId[];

export function migraFamily(id: string): MigraModelFamily | undefined {
  return (MIGRA_MODEL_FAMILIES as Record<string, MigraModelFamily>)[id];
}

/** Families a given surface may offer, in display order. */
export function familiesForSurface(surface: MigraProductSurface): MigraModelFamily[] {
  return MIGRA_FAMILY_IDS.map((id) => MIGRA_MODEL_FAMILIES[id]).filter((f) => f.surfaces.includes(surface));
}

/** The default a surface offers when the user has not chosen. */
export function recommendedFamily(surface: MigraProductSurface): MigraModelFamily | undefined {
  return familiesForSurface(surface).find((f) => f.recommended);
}

/**
 * Live resolution result, produced by the Brain — never by a UI.
 *
 * `executedBackend` is separate from `selectedBackend` on purpose: a divergence
 * between what was chosen and what actually ran is exactly the thing that must
 * stay visible, and it cannot be reconciled after the fact.
 */
export interface MigraFamilyResolution {
  family: MigraModelFamilyId;
  available: boolean;
  /** Why it is unavailable, in user-facing words. Present only when unavailable. */
  unavailableReason?: string;
  /** The backend governance resolved for this family right now. */
  selectedBackend?: string;
  /** Whether that selection came from a durable qualification decision. */
  governed: boolean;
  /** The governed capability or grant the decision rested on. */
  basis?: string;
}
