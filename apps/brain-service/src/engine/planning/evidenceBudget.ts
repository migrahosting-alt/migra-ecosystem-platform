/**
 * MigraAI Engine — explicit ceilings for a repository answer, and the measured
 * account of how they were spent.
 *
 * The previous loop had exactly two limits, both about TIME: 150s per model call
 * and 360s overall. Time is the wrong quantity to bound. A run that reads the same
 * file four times and carries an ever-growing transcript is not expensive because
 * it is slow; it is slow because it is wasteful, and a time limit answers waste by
 * cutting the answer off rather than by not being wasteful.
 *
 * So the budget is denominated in the things the plan actually consumes — files,
 * spans, evidence units, model calls, expansion rounds — and every one of them is
 * reported whether or not it bound. A ceiling that is never shown to the operator
 * is indistinguishable from silent truncation. © MigraTeck LLC.
 */

/** Why the plan stopped. Always reported — there is no unlabelled ending. */
export type StopReason =
  /** Every retained claim is supported by evidence. */
  | 'claims-supported'
  /** Nothing unsupported remains, but only labelled inference survived. */
  | 'inference-only'
  /** The verifier still reports gaps and no expansion budget is left. */
  | 'evidence-budget-exhausted'
  /** The model-call ceiling was reached. */
  | 'model-call-budget-exhausted'
  /** A model call or the run outran its time budget. */
  | 'time-budget-exhausted'
  /** The exploration fallback used every tool step it was allowed. */
  | 'tool-step-budget-exhausted'
  /** Ranking produced nothing to open — the plan never had a subject. */
  | 'no-candidates'
  /** The workspace is not a git repository, so no map could be built. */
  | 'map-unavailable';

export interface EvidenceBudget {
  /** Ranked map entries considered at all. */
  maxCandidates: number;
  /** Files whose content may be opened across the whole run. */
  maxFilesOpened: number;
  /** Distinct source spans held in the ledger. */
  maxSpans: number;
  /** Approximate context units (chars/4) of evidence. */
  maxEvidenceUnits: number;
  maxModelCalls: number;
  /** Steps allowed in the exploration fallback, when the map yields nothing. */
  maxToolSteps: number;
  /** How many times one path may be re-opened at a wider range. */
  maxExpansionsPerPath: number;
  /** Rounds of "the verifier named a gap, go get it". */
  maxExpansionRounds: number;
}

/**
 * Defaults for the small-scope acceptance target: two model calls, eight files,
 * one expansion round, no repeated read.
 *
 * `maxEvidenceUnits` is the one ceiling set purely from measurement — see the
 * note on the field itself.
 */
export const DEFAULT_EVIDENCE_BUDGET: EvidenceBudget = {
  maxCandidates: 40,
  maxFilesOpened: 8,
  maxSpans: 24,
  // Lowered from 12,000 after measurement, not taste: at 12,753 units the local
  // 30B did not return inside its 150s call budget at all, while the earlier
  // 8,704-unit calls returned in 30–90s. 6,000 sits inside the range the model
  // actually answers in, and the plan reports when it binds.
  maxEvidenceUnits: 6_000,
  maxModelCalls: 2,
  maxToolSteps: 6,
  maxExpansionsPerPath: 1,
  maxExpansionRounds: 1,
};

/**
 * Smallest meaningful value per ceiling.
 *
 * One is 0, deliberately. Zero files or zero model calls would answer every
 * question with an empty refusal, so those are misconfigurations. Zero TOOL steps
 * is a real policy — "planned path only, never explore" — and refusing to honour
 * it would be the same silent-substitution defect this project already fixed for
 * `tier`.
 */
export const MIN_BUDGET: Record<keyof EvidenceBudget, number> = {
  maxCandidates: 1,
  maxFilesOpened: 1,
  maxSpans: 1,
  maxEvidenceUnits: 1,
  maxModelCalls: 1,
  maxToolSteps: 0,
  maxExpansionsPerPath: 1,
  maxExpansionRounds: 1,
};

export function resolveBudget(overrides?: Partial<EvidenceBudget>): EvidenceBudget {
  const merged = { ...DEFAULT_EVIDENCE_BUDGET, ...(overrides ?? {}) };
  for (const key of Object.keys(merged) as Array<keyof EvidenceBudget>) {
    if (!Number.isFinite(merged[key]) || !Number.isInteger(merged[key]) || merged[key] < MIN_BUDGET[key]) {
      merged[key] = DEFAULT_EVIDENCE_BUDGET[key];
    }
  }
  return merged;
}

/** Everything a run spent, alongside what it was allowed. */
export interface BudgetSpend {
  candidatesConsidered: number;
  filesOpened: number;
  spans: number;
  evidenceUnits: number;
  modelCalls: number;
  toolSteps: number;
  expansionRounds: number;
  /** Ceilings that actually bound this run — the ones worth telling the operator. */
  binding: string[];
}

/**
 * Running account of a plan's spend.
 *
 * Every `can*` check records the ceiling it refuses on, so the run report can say
 * WHICH limit ended the plan instead of leaving the operator to infer it from a
 * count that happens to equal a constant.
 */
export class BudgetLedger {
  private readonly bindingSet = new Set<string>();
  private candidates = 0;
  private files = 0;
  private spanCount = 0;
  private units = 0;
  private calls = 0;
  private steps = 0;
  private rounds = 0;
  private renderedUnits: number | undefined;

  constructor(readonly budget: EvidenceBudget) {}

  noteCandidates(n: number): void {
    this.candidates = n;
  }

  /**
   * May another FILE be opened, given what it would cost?
   *
   * `estimatedUnits` is required because the file-count ceiling alone did NOT
   * bind: a run opened its full eight files and delivered 14,622 evidence units
   * against a 12,000-unit ceiling, because units were only checked when adding a
   * span to a file that was already open.
   */
  canOpenFile(estimatedUnits = 0): boolean {
    if (this.files >= this.budget.maxFilesOpened) {
      this.bindingSet.add('maxFilesOpened');
      return false;
    }
    if (this.spanCount >= this.budget.maxSpans) {
      this.bindingSet.add('maxSpans');
      return false;
    }
    // The FIRST file is always allowed: refusing it would answer every question
    // about a large file with an empty refusal.
    if (this.files > 0 && this.units + estimatedUnits > this.budget.maxEvidenceUnits) {
      this.bindingSet.add('maxEvidenceUnits');
      return false;
    }
    return true;
  }

  /** Units already committed — lets a caller size the next span to what is left. */
  get unitsRemaining(): number {
    return Math.max(0, this.budget.maxEvidenceUnits - this.units);
  }

  noteFileOpened(spanUnits: number): void {
    this.files += 1;
    this.spanCount += 1;
    this.units += spanUnits;
  }

  /** May another SPAN of an already-open file be added? */
  canAddSpan(spanUnits: number): boolean {
    if (this.spanCount >= this.budget.maxSpans) {
      this.bindingSet.add('maxSpans');
      return false;
    }
    if (this.units + spanUnits > this.budget.maxEvidenceUnits) {
      this.bindingSet.add('maxEvidenceUnits');
      return false;
    }
    return true;
  }

  noteSpanAdded(spanUnits: number): void {
    this.spanCount += 1;
    this.units += spanUnits;
  }

  canCallModel(): boolean {
    if (this.calls >= this.budget.maxModelCalls) {
      this.bindingSet.add('maxModelCalls');
      return false;
    }
    return true;
  }

  noteModelCall(): void {
    this.calls += 1;
  }

  canTakeToolStep(): boolean {
    if (this.steps >= this.budget.maxToolSteps) {
      this.bindingSet.add('maxToolSteps');
      return false;
    }
    return true;
  }

  noteToolStep(): void {
    this.steps += 1;
  }

  canExpand(): boolean {
    if (this.rounds >= this.budget.maxExpansionRounds) {
      this.bindingSet.add('maxExpansionRounds');
      return false;
    }
    return true;
  }

  noteExpansionRound(): void {
    this.rounds += 1;
  }

  noteBinding(ceiling: keyof EvidenceBudget): void {
    this.bindingSet.add(ceiling);
  }

  /**
   * Record the evidence units that ACTUALLY reached the model.
   *
   * The running total is an accounting of what was admitted; this is what the
   * prompt finally carried after hash-deduplication. Reporting the former as
   * though it were the latter is exactly the kind of plausible-but-unverified
   * number this project exists to stop producing.
   */
  noteRenderedUnits(units: number): void {
    this.renderedUnits = units;
  }

  get modelCalls(): number {
    return this.calls;
  }

  /** Files admitted so far — lets a caller honour the first-file exemption. */
  get filesOpened(): number {
    return this.files;
  }

  spend(): BudgetSpend {
    return {
      candidatesConsidered: this.candidates,
      filesOpened: this.files,
      spans: this.spanCount,
      evidenceUnits: this.renderedUnits ?? this.units,
      modelCalls: this.calls,
      toolSteps: this.steps,
      expansionRounds: this.rounds,
      binding: [...this.bindingSet],
    };
  }
}
