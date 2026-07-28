/**
 * MigraPilot Interaction Verification — the VS Code command adapter.
 *
 * The first adapter, deliberately: the command path is the one surface with existing
 * end-to-end acceptance evidence, so the runner can be checked against something real rather
 * than only against its own output.
 *
 * It reaches proof Level 3 when driven by `@vscode/test-electron` and Level 4 when the
 * extension under test came from the packaged VSIX. It CANNOT reach Level 5 — that needs the
 * operator's own session — and the report says so rather than rounding up.
 */

import * as vscode from 'vscode';
import { captureBaseline, classifyEffects, evidenceGaps } from './baseline.js';
import { clearCorrelations, correlationSince, type CorrelationEntry } from './correlationLog.js';
import {
  identityKey,
  type EffectKind,
  type EvidenceReport,
  type InteractionOutcome,
  type InteractionTrace,
  type ObservedEffect,
  type TimingClassification,
} from './types.js';

export interface RunOptions {
  /** Workspace root the baseline is measured against. */
  root: string;
  /** Proof level the HOST can substantiate. The report never claims more. */
  hostLevel: 1 | 2 | 3 | 4 | 5;
  /** Query the Brain audit for a correlation id. Absent ⇒ correlation is an evidence gap. */
  fetchAudit?(correlationId: string): Promise<Array<{ type: string }>>;
  /**
   * Read the correlation the interaction produced.
   *
   * INJECTED, because the runner must not assume it shares memory with the host it drives.
   * The extension may be loaded from a bundle that inlined its own copy of the log, and
   * reading module state across that boundary returns an empty list while looking exactly
   * like a turn that produced no correlation at all — observed, and the reason this is a
   * parameter rather than an import.
   */
  readCorrelation?(since: number): CorrelationEntry | null;
  /** Restore the environment. Returns after cleanup; residual effects are then measured. */
  cleanup?(): Promise<void>;
}

/**
 * Run one trace against one control.
 *
 * The order is fixed and load-bearing: baseline BEFORE anything is invoked, registration
 * checked before invocation, timing measured around the invocation alone, and effects
 * classified only after the interaction settles. Measuring the baseline after opening the
 * document, for instance, would silently absorb the very effect being verified.
 */
export async function runCommandTrace(trace: InteractionTrace, options: RunOptions): Promise<EvidenceReport> {
  const key = identityKey(trace.control);
  const before = captureBaseline(options.root);
  const gaps: string[] = [];

  // ── locator resolution ────────────────────────────────────────────────────
  // No fallback. An `exact` locator that does not resolve is a finding, and quietly trying a
  // fuzzy match would convert a registration regression into a passing run against whatever
  // else happened to match.
  const commands = await vscode.commands.getCommands(true);
  const commandFound = commands.includes(trace.locator.commandId);

  const base = {
    trace: trace.trace,
    control: { ...trace.control, key },
    locator: { ...trace.locator, resolved: commandFound },
    registration: { commandFound, totalCommands: commands.length },
    baselineBefore: before,
  };

  if (!commandFound) {
    // Declared but absent from the host: exactly the shape of the tree-shaken-selector
    // defect, caught before anything is invoked.
    const after = captureBaseline(options.root);
    return {
      ...base,
      outcome: 'undiscovered' as InteractionOutcome,
      levelReached: Math.min(options.hostLevel, 2) as 1 | 2,
      timing: { elapsedMs: 0, classification: 'completed', budget: trace.budget },
      effects: { observed: [], expected: trace.expected, forbidden: trace.forbidden, unexpected: [], violations: [] },
      correlation: { correlationId: null, auditEventTypes: [], auditMatched: false },
      cleanup: { verified: true, residual: [] },
      evidenceGaps: [
        `locator: command "${trace.locator.commandId}" is declared but not registered in this host`,
        ...evidenceGaps(before, after),
      ],
      baselineAfter: after,
    };
  }

  // ── invocation ────────────────────────────────────────────────────────────
  clearCorrelations();
  const invokedAt = Date.now();
  const started = performance.now();
  let waitingOn: string | undefined;
  let hung = false;

  try {
    hung = await withCeiling(vscode.commands.executeCommand(trace.locator.commandId), trace.budget.ceilingMs);
    if (hung) {
      // Naming the suspects is the difference between a diagnosis and a stack trace. VS Code
      // cannot enumerate open notifications, so this is a hypothesis, labelled as one.
      waitingOn = 'invocation never settled — candidates: an awaited notification or dialog, or an in-flight request';
    }
  } catch (error) {
    waitingOn = `invocation threw: ${String(error).slice(0, 200)}`;
  }
  const elapsedMs = Math.round(performance.now() - started);
  const timing: TimingClassification = hung ? 'hung' : elapsedMs > trace.budget.settleMs ? 'slow' : 'completed';

  // ── effects ───────────────────────────────────────────────────────────────
  const after = captureBaseline(options.root);
  const observed = classifyEffects(before, after);
  const violations = observed.filter((e) => trace.forbidden.includes(e.kind));
  const unexpected = observed.filter((e) => !trace.expected.includes(e.kind) && !trace.forbidden.includes(e.kind));

  // ── correlation ───────────────────────────────────────────────────────────
  const read = options.readCorrelation ?? correlationSince;
  const entry: CorrelationEntry | null = read(invokedAt);
  let auditEventTypes: string[] = [];
  let auditMatched = false;
  if (!entry) {
    gaps.push('correlation: the interaction produced no correlation id — no server turn was observed');
  } else if (!options.fetchAudit) {
    gaps.push('audit: no audit reader was provided, so server-side records were not correlated');
  } else {
    try {
      const records = await options.fetchAudit(entry.correlationId);
      auditEventTypes = [...new Set(records.map((r) => r.type))].sort();
      const required = trace.expectAuditEvents ?? [];
      auditMatched = required.every((t) => auditEventTypes.includes(t));
    } catch (error) {
      gaps.push(`audit: query failed (${String(error).slice(0, 120)})`);
    }
  }

  // ── cleanup, verified rather than attempted ───────────────────────────────
  let residual: ObservedEffect[] = [];
  let cleanupVerified = true;
  if (options.cleanup) {
    await options.cleanup();
    const restored = captureBaseline(options.root);
    // Only forbidden dimensions must return to baseline. An expected document that the
    // trace opened and the cleanup closed is not residue; an unexpected file is.
    residual = classifyEffects(before, restored).filter((e) => !trace.expected.includes(e.kind));
    cleanupVerified = residual.length === 0;
  } else {
    gaps.push('cleanup: no cleanup was declared, so restoration was not verified');
    cleanupVerified = false;
  }

  const outcome = decideOutcome({ timing, violations, unexpected, observed, expected: trace.expected });

  return {
    ...base,
    outcome,
    // The trace may ASK for a level; the host decides what it can substantiate.
    levelReached: Math.min(trace.level, options.hostLevel) as 1 | 2 | 3 | 4 | 5,
    timing: { elapsedMs, classification: timing, budget: trace.budget, ...(waitingOn ? { waitingOn } : {}) },
    effects: { observed, expected: trace.expected, forbidden: trace.forbidden, unexpected, violations },
    correlation: { correlationId: entry?.correlationId ?? null, auditEventTypes, auditMatched },
    cleanup: { verified: cleanupVerified, residual },
    evidenceGaps: [...gaps, ...evidenceGaps(before, after)].sort(),
    baselineAfter: after,
  };
}

function decideOutcome(input: {
  timing: TimingClassification;
  violations: ObservedEffect[];
  unexpected: ObservedEffect[];
  observed: ObservedEffect[];
  expected: EffectKind[];
}): InteractionOutcome {
  if (input.timing === 'hung') return 'hung';
  if (input.violations.length > 0) return 'failed';
  // Unclassified change is a failure, not a warning: an effect nobody declared is an effect
  // nobody reviewed.
  if (input.unexpected.length > 0) return 'failed';
  // Accepted, and nothing happened at all — the button that does nothing. Only meaningful
  // when the trace expected something; a trace expecting nothing is satisfied by nothing.
  if (input.observed.length === 0 && input.expected.length > 0) return 'inert';
  return 'verified';
}

/**
 * True when the ceiling passed before the work settled.
 *
 * The underlying work is NOT cancelled — a hung invocation is evidence, and cancelling it
 * would destroy the state a human needs to see. The runner stops waiting; the host keeps
 * whatever it was doing.
 */
async function withCeiling<T>(work: Thenable<T>, ceilingMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<'ceiling'>((resolve) => {
    timer = setTimeout(() => resolve('ceiling'), ceilingMs);
  });
  try {
    return (await Promise.race([Promise.resolve(work).then(() => 'settled' as const), ceiling])) === 'ceiling';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
