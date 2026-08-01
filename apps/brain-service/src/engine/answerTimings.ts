/**
 * MigraAI Engine — per-model-call timing for the agentic answer path.
 *
 * A repository-scale run failed after ~331s and surfaced as a single opaque 502.
 * The obvious reading — "one outer timeout fired" — was wrong, and being wrong
 * about it points at the wrong fix: the run had actually burned TWO separate
 * {@link PER_CALL_BUDGET-sized} model budgets plus enumeration and tool overhead,
 * and never reached the 360s overall deadline at all. Raising the outer deadline
 * would have changed nothing.
 *
 * So the loop measures each model call on its own, and a timeout reports WHICH
 * call exhausted WHICH budget with the context it was carrying. The rule this
 * encodes: never report a per-call budget exhaustion as a generic request timeout.
 *
 * PURE: the clock is injected, so every field is assertable in a unit test without
 * waiting real seconds. © MigraTeck LLC.
 */

/** Which model call this was, within the run's structure. */
export type CallPhase = 'tool_loop' | 'final_synthesis_stream' | 'final_synthesis_retry';

export type CallOutcome = 'ok' | 'timeout' | 'error' | 'aborted';

/**
 * Why a call stopped early. The distinction is the whole point of this module:
 * `model_call_timeout` is one call outrunning its own budget, which is a scope or
 * model-speed problem; `overall_deadline` is the run outrunning its ceiling.
 */
export type TimeoutCategory = 'model_call_timeout' | 'overall_deadline' | 'client_abort';

/** The coarse stage a run was in when something went wrong. */
export type RunPhase =
  | 'enumeration'
  | 'evidence_selection'
  | 'prompt_construction'
  | 'model_inference'
  | 'tool_execution'
  | 'answer_verification'
  | 'complete';

export interface ModelCallTiming {
  /** 1-based: the first model call of the run is `1`. */
  callIndex: number;
  phase: CallPhase;
  model: string;
  runner: 'local' | 'cloud';
  /** Milliseconds allotted to THIS call. */
  budgetMs: number;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  outcome: CallOutcome;
  timeoutCategory?: TimeoutCategory;
  /** Characters of prompt+context handed to the model for this call. */
  promptChars: number;
  promptMessages: number;
  /** chars/4 — an approximation, labelled as one, not a token count. */
  approxContextUnits: number;
  /** Distinct workspace files represented in this call's context. */
  contextFileCount: number;
  contextFiles: string[];
  toolStepsBefore: number;
  toolStepsAfter: number;
}

/** Structured evidence returned INSTEAD of a generic failure when a budget runs out. */
export interface TimeoutEvidence {
  category: TimeoutCategory;
  callIndex: number;
  callBudgetMs: number;
  elapsedMs: number;
  contextFileCount: number;
  lastObservedPhase: RunPhase;
  partialEvidenceAvailable: boolean;
  /** Total run time when the budget was exhausted — distinguishes 1 call from 2. */
  runElapsedMs: number;
  modelCallsCompleted: number;
}

export interface AnswerRunTimings {
  totalMs: number;
  /** Deterministic seeding retrieval — locating candidate code before any model call. */
  enumerationMs: number;
  /** Filtering/ranking those candidates down to the evidence actually seeded. */
  evidenceSelectionMs: number;
  /** Assembling the system + user messages. */
  promptConstructionMs: number;
  /** Read-only tool execution, summed across the run. */
  toolExecutionMs: number;
  /** Claim-level grounding of the final answer. */
  verificationMs: number;
  /** Wall-clock spent inside model calls, summed. */
  modelInferenceMs: number;
  calls: ModelCallTiming[];
  /** Files read more than once — wasted budget the scope pass should eliminate. */
  repeatedReads: Array<{ path: string; count: number }>;
  lastObservedPhase: RunPhase;
}

export interface CallStart {
  phase: CallPhase;
  model: string;
  runner: 'local' | 'cloud';
  budgetMs: number;
  /** The exact messages being sent — sizes are measured, never estimated by hand. */
  messages: ReadonlyArray<{ content?: string }>;
  contextFiles: string[];
  toolStepsBefore: number;
}

/** Handle for an in-flight call; `end` is what writes the record. */
export interface CallHandle {
  readonly callIndex: number;
  end(outcome: CallOutcome, opts?: { timeoutCategory?: TimeoutCategory; toolStepsAfter?: number }): ModelCallTiming;
}

const APPROX_CHARS_PER_UNIT = 4;

export class AnswerTimeline {
  private readonly clock: () => number;
  private readonly origin: number;
  private readonly callRecords: ModelCallTiming[] = [];
  private readonly phaseTotals: Record<string, number> = {};
  private readonly openPhases = new Map<string, number>();
  private phase: RunPhase = 'enumeration';
  private timeout: TimeoutEvidence | undefined;
  private repeated: Array<{ path: string; count: number }> = [];

  constructor(clock: () => number = () => performance.now()) {
    this.clock = clock;
    this.origin = clock();
  }

  /** Milliseconds since the run started. */
  elapsed(): number {
    return Math.round(this.clock() - this.origin);
  }

  get lastObservedPhase(): RunPhase {
    return this.phase;
  }

  markPhase(phase: RunPhase): void {
    this.phase = phase;
  }

  /** Time a named stage. Returns a function that closes it. */
  beginPhase(name: RunPhase): () => void {
    const key = String(name);
    this.markPhase(name);
    this.openPhases.set(key, this.clock());
    return () => {
      const started = this.openPhases.get(key);
      if (started === undefined) return;
      this.openPhases.delete(key);
      this.phaseTotals[key] = (this.phaseTotals[key] ?? 0) + (this.clock() - started);
    };
  }

  /** Record which files were read more than once (fed in from the ledger). */
  noteRepeatedReads(repeated: Array<{ path: string; count: number }>): void {
    this.repeated = repeated;
  }

  beginCall(start: CallStart): CallHandle {
    const callIndex = this.callRecords.length + 1;
    const startedAtMs = Math.round(this.clock() - this.origin);
    const promptChars = start.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    const contextFiles = [...new Set(start.contextFiles)];
    this.markPhase('model_inference');

    const record: ModelCallTiming = {
      callIndex,
      phase: start.phase,
      model: start.model,
      runner: start.runner,
      budgetMs: start.budgetMs,
      startedAtMs,
      endedAtMs: startedAtMs,
      durationMs: 0,
      outcome: 'ok',
      promptChars,
      promptMessages: start.messages.length,
      approxContextUnits: Math.ceil(promptChars / APPROX_CHARS_PER_UNIT),
      contextFileCount: contextFiles.length,
      contextFiles,
      toolStepsBefore: start.toolStepsBefore,
      toolStepsAfter: start.toolStepsBefore,
    };
    this.callRecords.push(record);

    return {
      callIndex,
      end: (outcome, opts) => {
        record.endedAtMs = Math.round(this.clock() - this.origin);
        record.durationMs = record.endedAtMs - record.startedAtMs;
        record.outcome = outcome;
        record.toolStepsAfter = opts?.toolStepsAfter ?? record.toolStepsBefore;
        if (opts?.timeoutCategory) record.timeoutCategory = opts.timeoutCategory;
        return record;
      },
    };
  }

  /**
   * Record the budget exhaustion that ended the run.
   *
   * Only the FIRST is kept: a synthesis call that also times out is a consequence of
   * the first exhaustion, and reporting the last one would name the wrong call.
   */
  recordTimeout(call: ModelCallTiming, category: TimeoutCategory, partialEvidenceAvailable: boolean): TimeoutEvidence {
    const evidence: TimeoutEvidence = {
      category,
      callIndex: call.callIndex,
      callBudgetMs: call.budgetMs,
      elapsedMs: call.durationMs,
      contextFileCount: call.contextFileCount,
      lastObservedPhase: this.phase,
      partialEvidenceAvailable,
      runElapsedMs: this.elapsed(),
      modelCallsCompleted: this.callRecords.filter((c) => c.outcome === 'ok').length,
    };
    if (!this.timeout) this.timeout = evidence;
    return evidence;
  }

  get timeoutEvidence(): TimeoutEvidence | undefined {
    return this.timeout;
  }

  get calls(): readonly ModelCallTiming[] {
    return this.callRecords;
  }

  snapshot(): AnswerRunTimings {
    const total = (k: string): number => Math.round(this.phaseTotals[k] ?? 0);
    return {
      totalMs: this.elapsed(),
      enumerationMs: total('enumeration'),
      evidenceSelectionMs: total('evidence_selection'),
      promptConstructionMs: total('prompt_construction'),
      toolExecutionMs: total('tool_execution'),
      verificationMs: total('answer_verification'),
      modelInferenceMs: this.callRecords.reduce((n, c) => n + c.durationMs, 0),
      calls: this.callRecords.map((c) => ({ ...c, contextFiles: [...c.contextFiles] })),
      repeatedReads: this.repeated,
      lastObservedPhase: this.phase,
    };
  }
}

/** One-line operator summary — what actually consumed the wall clock. */
export function describeTimings(t: AnswerRunTimings): string {
  const calls = t.calls
    .map((c) => `#${c.callIndex} ${c.phase} ${c.model} ${c.durationMs}ms/${c.budgetMs}ms ${c.outcome}${c.timeoutCategory ? `(${c.timeoutCategory})` : ''} ctx=${c.contextFileCount}f/${c.approxContextUnits}u`)
    .join('; ');
  return `total=${t.totalMs}ms enum=${t.enumerationMs}ms select=${t.evidenceSelectionMs}ms prompt=${t.promptConstructionMs}ms tools=${t.toolExecutionMs}ms verify=${t.verificationMs}ms model=${t.modelInferenceMs}ms | ${calls || 'no model calls'}`;
}
