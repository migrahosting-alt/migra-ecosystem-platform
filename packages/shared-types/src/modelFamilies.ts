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
 * READINESS IS COMPUTED, NEVER ASSERTED. `auditedStatus` below records what was
 * MEASURED on the date given — it is evidence, not a promise. A surface must ask
 * the Brain what is resolvable right now; a family with no qualified path is
 * reported unavailable rather than quietly served by something weaker.
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

/** Honest lifecycle state. Ordered from strongest to weakest claim. */
export type MigraFamilyStatus =
  /** The real user-facing workflow passed on a live product surface. */
  | 'PROVEN_LIVE'
  /** Built and wired, but the live product-surface proof has not been run. */
  | 'IMPLEMENTED_NEEDS_LIVE_PROOF'
  /** Some capability qualified, others not. The gap must be named. */
  | 'PARTIAL'
  /** A specific, identified thing prevents it. The blocker must be named. */
  | 'BLOCKED'
  /** Named and specified only. Nothing is wired. */
  | 'INTENT';

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

export interface MigraFamilyAudit {
  status: MigraFamilyStatus;
  /** ISO date the status was measured. A status without a date is an opinion. */
  measuredOn: string;
  /** What was actually observed — the basis for the status. */
  finding: string;
  /** What must happen to raise the status. Empty only for PROVEN_LIVE. */
  toAdvance?: string;
}

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
  auditedStatus: MigraFamilyAudit;
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
    requirements: { capabilities: ['chat', 'tools'], minTier: 'balanced', prefer: 'fastest' },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
    recommended: true,
    auditedStatus: {
      status: 'PARTIAL',
      measuredOn: '2026-09-02',
      finding:
        'A balanced chat+tools model resolves and answers live (chat turns routed and returned real ' +
        'answers). But there is no governed capability for general chat at all, so the path is ' +
        'UNGOVERNED — nothing qualified it, and nothing would stop it changing.',
      toAdvance: 'Define and qualify a general-chat capability so Core resolves through governance rather than tier alone.',
    },
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
      taskClasses: ['patch-planning', 'dependency-analysis'],
    },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
    auditedStatus: {
      status: 'BLOCKED',
      measuredOn: '2026-09-02',
      finding:
        'Reasoning-capable deep models are installed. But the task classes this family exists to serve ' +
        '— patch-planning, code-review, security-review — all require the CLOUD tier, and the Brain ' +
        'reports "Cloud providers are disabled or unavailable". dependency-analysis is deep-local but ' +
        'carries approvedLocalCapability: [] (never measured).',
      toAdvance:
        'Either measure a deep-local model against those task families and grant it, or enable a governed cloud path.',
    },
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
    auditedStatus: {
      status: 'PARTIAL',
      measuredOn: '2026-09-02',
      finding:
        'Coding models resolve and the full 16-tool workspace surface executes through the extension ' +
        'with governed delegation. Grants are approved for typed-implementation (fast-local) and ' +
        'repository-diagnosis (deep-local) only; multi-file-change, refactoring, regression-repair, ' +
        'test-generation and tool-use-decision all carry approvedLocalCapability: []. A live multi-tool ' +
        'run also failed on model judgment, not capability: the tools returned structured results and ' +
        'the model then emitted invalid JSON.',
      toAdvance:
        'Measure and grant the remaining coding task classes, and re-run multi-tool acceptance on a deep-local coder.',
    },
  },

  'migra-swift': {
    id: 'migra-swift',
    displayName: 'Migra Swift',
    tagline: 'Fastest for quick and routine tasks',
    description: 'Fast, lightweight answers for quick and routine work.',
    requirements: { capabilities: ['chat'], minTier: 'fast', prefer: 'fastest' },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
    auditedStatus: {
      status: 'BLOCKED',
      measuredOn: '2026-09-02',
      finding:
        'There is no fast GENERAL-chat model installed. The fast tier holds only coder models ' +
        '(qwen2.5-coder 1.5b/7b) and vision models (llava, minicpm-v); the smallest general chat model, ' +
        'qwen3:8b, is classified balanced. Resolving Swift today would hand general questions to a ' +
        'coder model, which is exactly the silent downgrade this catalog forbids.',
      toAdvance: 'Install and qualify a small general-purpose chat model, or reclassify one honestly.',
    },
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
    auditedStatus: {
      status: 'PROVEN_LIVE',
      measuredOn: '2026-09-02',
      finding:
        'vision.general holds a durable governed decision against an exact digest, enforcement is ON, ' +
        'and the production Brain names it as the model an image turn would actually use. Proven on the ' +
        'real path: a mockup carrying a planted unguessable token was read back correctly, so the answer ' +
        'cannot have been a plausible guess.',
      toAdvance:
        'vision.object_counting remains deliberately unqualified — counting is a separate capability and ' +
        'is correctly reported as unavailable rather than approximated.',
    },
  },

  'migra-atlas': {
    id: 'migra-atlas',
    displayName: 'Migra Atlas',
    tagline: 'Best for long documents and large-context work',
    description: 'Long-context work: long conversations, large PDFs, large document sets and corpus-heavy analysis.',
    requirements: { capabilities: ['chat'], minTier: 'balanced', minContextTokens: 128_000, prefer: 'strongest' },
    surfaces: ['migrapilot-consumer', 'vscode-extension'],
    fallback: { kind: 'none' },
    auditedStatus: {
      status: 'INTENT',
      measuredOn: '2026-09-02',
      finding:
        'Models advertising large context exist (up to 262144 tokens). But NOTHING has measured whether ' +
        'the Brain actually drives that window end to end, and no qualification covers long-context work. ' +
        'An advertised context length is a spec sheet, not a capability.',
      toAdvance:
        'Measure real retrieval and answer quality at depth, then define and qualify a long-context capability.',
    },
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
