/**
 * MigraPilot protocol — CAPABILITY AUTHORITY: what a model is allowed to do,
 * per task class, on measured evidence.
 *
 * A THIRD governance axis, independent of the first two. Repository grounding answers
 * "what repository material may be used". Live knowledge answers "may external
 * information be consulted". This answers "may THIS MODEL act on THIS KIND OF WORK, and
 * on what evidence do we believe it can".
 *
 * Distinct from model qualification (`QualificationInfo`), which asks whether a model may
 * serve a size TIER at all. A model can be perfectly qualified to serve `balanced` and
 * still have no authority to review security-sensitive diffs. Parameter count and
 * reputation are not evidence; a measured score on that task class is.
 *
 * The rule this encodes: NO MODEL RECEIVES AUTHORITY IT HAS NOT EARNED. A model that is
 * fast but unsafe cannot plan protected changes. A model that writes correct small
 * functions but misses SSRF defects cannot perform autonomous security review. A model
 * that invents interfaces cannot make unsupervised architecture changes.
 */

/**
 * Task families, matching the benchmark's expansion plan so a grant can always be traced
 * to the family that measured it.
 *
 * `unclassified` is not a family. It is the honest answer when a caller did not declare
 * one, and it carries no authority — see {@link CapabilityAuthority}.
 */
export const TASK_CLASSES = [
  'repository-diagnosis',
  'typed-implementation',
  'regression-repair',
  'test-generation',
  'refactoring',
  'patch-planning',
  'dependency-analysis',
  'security-review',
  'governance-compliance',
  'tool-use-decision',
  'multi-file-change',
  'code-review',
  'unclassified',
] as const;

export type TaskClass = (typeof TASK_CLASSES)[number];

export function isTaskClass(value: unknown): value is TaskClass {
  return typeof value === 'string' && (TASK_CLASSES as readonly string[]).includes(value);
}

/**
 * Coerce an untrusted value to a task class — FAILS to `unclassified`, never to a family.
 *
 * Guessing a family from a malformed value would invent the very evidence link this axis
 * exists to require. Declared by the CALLER from an explicit field, never inferred from
 * prompt text: a model that could widen its own authority by phrasing would make this
 * boundary decorative, exactly as it would for grounding and live knowledge.
 */
export function parseTaskClass(value: unknown): TaskClass {
  return isTaskClass(value) ? value : 'unclassified';
}

/**
 * Execution tiers, ordered by escalating capability and cost.
 *
 * The tier is chosen from task RISK and complexity, not from what happens to be
 * installed. Pretending one local model is competent at everything is the failure this
 * ladder exists to prevent.
 */
export const AUTHORITY_TIERS = ['fast-local', 'deep-local', 'cloud', 'human-approval'] as const;
export type AuthorityTier = (typeof AUTHORITY_TIERS)[number];

const TIER_RANK: Record<AuthorityTier, number> = {
  'fast-local': 0,
  'deep-local': 1,
  cloud: 2,
  'human-approval': 3,
};

/** Is `a` at least as escalated as `b`? Used to check a route against a requirement. */
export function tierAtLeast(a: AuthorityTier, b: AuthorityTier): boolean {
  return TIER_RANK[a] >= TIER_RANK[b];
}

/**
 * What a model may do with a task class.
 *
 *  autonomous  may act and its output stands on its own
 *  advisory    may produce output, but it is NOT authoritative — review or escalation
 *              is required before the result is relied on
 *  denied      must not act on this class; escalate to a higher tier or a human
 *  ungoverned  no grant applies because no task class was declared. NOT a permission —
 *              it records that this turn is outside the capability system, which is the
 *              honest statement while callers have not yet been taught to classify.
 */
export const CAPABILITY_AUTHORITIES = ['autonomous', 'advisory', 'denied', 'ungoverned'] as const;
export type CapabilityAuthority = (typeof CAPABILITY_AUTHORITIES)[number];

/** Why we believe a model can do this. A grant without evidence is a guess. */
export interface CapabilityEvidence {
  /** Commit of the benchmark that produced the score, so the claim is reproducible. */
  benchCommit: string;
  /** Score and maximum on that task class. */
  score: number;
  maxScore: number;
  /** ISO date of the measurement. */
  measuredAt: string;
  /**
   * True when the score came from MECHANICAL scoring — executing code, running tests,
   * diffing a tree, or matching against a planted ground-truth list.
   *
   * Load-bearing: a score the assistant produced by reading output is sound for REFUSING
   * authority and unsound for granting it, because the same model would be marking its
   * own homework. Only mechanically-scored evidence may back `autonomous`.
   */
  mechanical: boolean;
  note?: string;
}

/**
 * WHY a task class requires the tier it requires.
 *
 *  intrinsic-risk   a property of what a wrong answer COSTS, independent of any model.
 *                   Governance sign-off needs a human because accountability cannot be
 *                   delegated to software, not because software scored badly.
 *  measured-policy  derived from measurement, therefore REVOCABLE and re-earnable. "No
 *                   local model has passed the review benchmark" is a fact about the models
 *                   evaluated on a date, not a truth about the task.
 *
 * The distinction exists because a conservative default becomes doctrine the moment nobody
 * can tell which kind it was. A `measured-policy` entry must name its evidence and the
 * trigger that would revisit it.
 */
export type TierBasis = 'intrinsic-risk' | 'measured-policy';

/** The measurement behind a `measured-policy` tier requirement. */
export interface TierPolicyEvidence {
  /** Benchmark version — the commit whose fixtures and scores produced this. */
  benchCommit: string;
  evaluatedModels: readonly string[];
  /** Cases per model on this class. Small numbers are stated, not hidden. */
  sampleSize: number;
  scoringMethod: 'mechanical' | 'reviewed' | 'mixed';
  decidedAt: string;
  /** What would cause this requirement to be re-derived. */
  reevaluationTrigger: string;
}

/**
 * A task class's execution requirement, with its basis.
 *
 * `approvedLocalCapability` is the operator-facing answer to "can anything here do this
 * locally today" — an empty list means none, and says so rather than leaving it implied.
 */
export interface TierPolicy {
  taskClass: TaskClass;
  requiredTier: AuthorityTier;
  basis: TierBasis;
  /** Models with standing to serve this class locally. Empty = none today. */
  approvedLocalCapability: readonly string[];
  reason: string;
  evidence?: TierPolicyEvidence;
}

/** One measured grant: this model, this task class, this much authority. */
export interface CapabilityGrant {
  model: string;
  taskClass: TaskClass;
  authority: CapabilityAuthority;
  /** The lowest tier that may serve this class at all, whatever the model. */
  requiredTier: AuthorityTier;
  evidence?: CapabilityEvidence;
}

/**
 * The decision for one turn, and the disclosure the host renders from it.
 *
 * `unverified` is the list of things this turn could NOT establish. Silent degradation is
 * prohibited platform-wide, and an empty capability claim is a degradation like any other.
 */
export interface CapabilityDecision {
  /** Declared by the caller; `unclassified` when it was not. */
  taskClass: TaskClass;
  /** The model that actually acted. */
  model: string;
  authority: CapabilityAuthority;
  /** Tier this class requires. */
  requiredTier: AuthorityTier;
  /** Tier the routed model actually represents. */
  routedTier: AuthorityTier;
  /**
   * True when the routed tier fails to meet `requiredTier`, or the model holds no
   * autonomous grant for a class that needs one. The turn may still run — this records
   * that it ran WITHOUT backing, rather than letting the gap pass unremarked.
   */
  belowRequiredTier: boolean;
  evidenceBacked: boolean;
  /** Operator-facing reason. Never a model's self-assessment. */
  reason: string;
  /** What could not be verified for this turn. */
  unverified: string[];
}

/**
 * What KIND of consequence a tool can have.
 *
 * Classified by consequence rather than by name, so a newly registered tool inherits a
 * class instead of slipping through an id allowlist that nobody updated.
 */
export const TOOL_AUTHORITY_CLASSES = ['read-only', 'mutation', 'approval', 'production'] as const;
export type ToolAuthorityClass = (typeof TOOL_AUTHORITY_CLASSES)[number];

/**
 * Which tool classes an authority level may USE — not merely be told about.
 *
 * Advertising a narrower tool list is not enforcement: a model that names an unadvertised
 * tool will still reach the executor unless the executor checks. So this set gates
 * EXECUTION, and advertisement is derived from it rather than the other way round.
 */
export function permittedToolClasses(authority: CapabilityAuthority): readonly ToolAuthorityClass[] {
  switch (authority) {
    case 'autonomous':
      // Read and mutate within the granted scope. Approval and production remain separate
      // grants — being trusted to write a file is not being trusted to deploy it.
      return ['read-only', 'mutation'];
    case 'advisory':
      // May analyse and propose. A proposal is read-only work: it produces a reviewable
      // artifact and changes nothing.
      return ['read-only'];
    case 'denied':
      // Nothing. The governed action is refused before the model is called.
      return [];
    case 'ungoverned':
      // Ordinary conversation and inspection. Consequential tools stay withheld until a
      // task class is declared, so an unclassified turn cannot bypass governance.
      return ['read-only'];
  }
}

/** May this authority level use a tool of this class? */
export function toolClassPermitted(authority: CapabilityAuthority, cls: ToolAuthorityClass): boolean {
  return permittedToolClasses(authority).includes(cls);
}

/**
 * A host-owned refusal for a governed action the routed model has no standing for.
 *
 * Rendered from the decision with NO model involvement. The point is that a denied
 * security review produces this instead of model prose — presenting generated analysis as
 * a security review is the specific dishonesty being prevented.
 */
export interface CapabilityRefusal {
  code: 'CAPABILITY_DENIED';
  taskClass: TaskClass;
  availableTier: AuthorityTier;
  requiredTier: AuthorityTier;
  basis?: TierBasis;
  evidence?: string;
  message: string;
}

/**
 * Host-rendered capability disclosure.
 *
 * Produced from the decision, never asked of the model — the same rule the repository
 * source badge and the live-knowledge frame follow. "Say which tier you used" is a
 * request; this is a guarantee.
 */
export function capabilityDisclosure(d: CapabilityDecision): string[] {
  const lines = [`Capability: ${d.model} — ${d.authority} for ${d.taskClass}`];
  lines.push(`Tier: ${d.routedTier}${d.requiredTier !== d.routedTier ? ` (this class requires ${d.requiredTier})` : ''}`);
  if (d.belowRequiredTier) {
    lines.push(`⚠ This turn ran below the tier its task class requires — treat the result as unreviewed.`);
  }
  // Suppressed when ungoverned: "no evidence for unclassified" is noise — there is no
  // class to have evidence FOR, and the reason line already says none was declared.
  if (!d.evidenceBacked && d.authority !== 'ungoverned') {
    lines.push(`No measured capability evidence backs this model for ${d.taskClass}.`);
  }
  for (const u of d.unverified) lines.push(`Not verified: ${u}`);
  return lines;
}
