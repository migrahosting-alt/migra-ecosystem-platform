/**
 * The evidence object.
 *
 * WHAT THIS IS FOR. Across a long run of work, individually reasonable steps
 * repeatedly produced confident wrong conclusions: a filename trusted instead of
 * the file, a metric that had never been shown capable of failing, two samples
 * called systematic, a detector whose negative result meant nothing because it
 * never examined the elements that mattered. Every one of those was publishable
 * because "done" was a word rather than a checked condition.
 *
 * So a claim is a RECORD, not a sentence. It carries what was requested, what
 * actually executed, what the artefacts hash to, how many samples support it,
 * which controls were run, and who said so. Promotion is then a function of that
 * record, evaluated by `transition.ts` — not a judgement the author makes about
 * their own work.
 *
 * NOTHING HERE INTERPRETS ABSENCE AS SUCCESS. Every field that could carry
 * "unknown" is nullable and is treated as unproven, never as pass. That single
 * rule is the reason this module exists.
 */

/**
 * The finite status set.
 *
 * The forward path is INTENT → OBSERVED → PARTIAL → PROVEN_LIVE. The rest are
 * side or terminal states that a claim can reach from several places, because
 * work stops for more reasons than it succeeds.
 */
export const CLAIM_STATUSES = [
  /** Declared, no evidence gathered yet. The honest starting state. */
  'INTENT',
  /** Evidence exists but does not meet the bar for proof. */
  'OBSERVED',
  /** Some acceptance checks pass and others fail or are missing. */
  'PARTIAL',
  /** Fully evidenced against the real path. The only positive terminal state. */
  'PROVEN_LIVE',
  /** Was believed, later disproven. Terminal; original evidence is preserved. */
  'WITHDRAWN',
  /** Replaced by a newer claim about the same subject. Terminal. */
  'SUPERSEDED',
  /** Promotion was attempted and the machine rejected it. Terminal until re-evidenced. */
  'REFUSED',
  /** Cannot proceed for an external reason. Not a failure, and not a pass. */
  'BLOCKED',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Statuses from which no further forward progress is possible without a new claim. */
export const TERMINAL_STATUSES: readonly ClaimStatus[] = ['WITHDRAWN', 'SUPERSEDED'];

/**
 * How much repetition a claim needs before a result counts as a property of the
 * system rather than of one run.
 *
 * `deterministic` is a real category, not an escape hatch: an HTTP assertion
 * against a fixed route either holds or does not, and running it five times
 * proves nothing the first run did not. It must be declared explicitly — the
 * default is the expensive one, because the failure this guards is someone
 * generalising from a single stochastic sample.
 */
export type Determinism = 'deterministic' | 'stochastic';

/** A named artefact and what it actually hashes to. */
export interface HashedArtifact {
  /** Path, id or URL — enough to find it again. */
  ref: string;
  /** The digest of the bytes, or null when it was never computed. */
  sha256: string | null;
}

/**
 * A control that shows the verifier can fail.
 *
 * A measurement nobody has seen fail is not a measurement. Recording controls as
 * data — rather than trusting that someone ran one — is what lets promotion
 * refuse a metric that has only ever returned green.
 */
export interface Control {
  /** What was deliberately broken or withheld. */
  name: string;
  /** What the verifier did when it was. */
  outcome: 'failed_as_expected' | 'passed_unexpectedly' | 'not_run';
}

export interface Actor {
  /** Who or what produced this evidence. */
  id: string;
  kind: 'agent' | 'human' | 'ci';
}

/**
 * One acceptance check and its result.
 *
 * `null` means NOT MEASURED and is never read as a pass — the distinction that
 * "we could not check" and "there is nothing wrong" are opposite statements.
 */
export interface AcceptanceCheck {
  name: string;
  passed: boolean | null;
  detail?: string;
}

export interface Evidence {
  /** What is being asserted, in plain words. */
  claim: string;
  /** The capability or surface the claim is about. */
  subject: string;

  /**
   * WHAT WAS ASKED FOR versus WHAT ACTUALLY RAN.
   *
   * Kept as separate fields precisely so they can disagree. A job that requested
   * one model and executed another, or asked for local and silently fell back to
   * remote, has produced a real result about something nobody asked for — and
   * that is invisible if only one of these is recorded.
   */
  requestedRoute: string | null;
  executedRoute: string | null;
  requestedModel: string | null;
  executedModel: string | null;

  /** Where the assertion came from — a log, a probe, a screenshot, a suite. */
  provenance: string | null;
  /** The revision of the thing that actually ran, not of the working tree. */
  runtimeRevision: string | null;

  inputs: HashedArtifact[];
  outputs: HashedArtifact[];

  determinism: Determinism;
  /** How many independent runs support this. */
  sampleCount: number;
  controls: Control[];
  acceptanceChecks: AcceptanceCheck[];

  /**
   * Evidence taken from the real product path rather than a test harness.
   * Required for product-facing claims: a green suite is not a working feature.
   */
  liveProbe: string | null;
  /** Whether this claim is about something a user can see or do. */
  productFacing: boolean;

  /** What this claim explicitly does NOT cover. */
  knownLimits: string[];

  actor: Actor;
  observedAt: string;
}

/** A partial evidence record, for the common case of building one up. */
export function emptyEvidence(claim: string, subject: string, actor: Actor): Evidence {
  return {
    claim,
    subject,
    requestedRoute: null,
    executedRoute: null,
    requestedModel: null,
    executedModel: null,
    provenance: null,
    runtimeRevision: null,
    inputs: [],
    outputs: [],
    /*
     * STOCHASTIC BY DEFAULT. The cheap assumption is that one run is enough, and
     * that assumption is what turns a lucky result into a reported finding.
     * Claiming determinism has to be a deliberate act.
     */
    determinism: 'stochastic',
    sampleCount: 0,
    controls: [],
    acceptanceChecks: [],
    liveProbe: null,
    productFacing: true,
    knownLimits: [],
    actor,
    observedAt: new Date().toISOString(),
  };
}
