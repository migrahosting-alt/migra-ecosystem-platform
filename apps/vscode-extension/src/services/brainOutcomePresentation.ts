// MigraPilot — the single renderer for every user-visible Brain-operation outcome.
//
// Status bar, progress UI, notifications and the work report must all pass through
// here. That is the point: if each surface derived its own wording from a partial
// view, one of them would eventually say "done" while the record said otherwise —
// which is precisely the failure this whole slice exists to prevent.
//
// Deliberately free of `vscode` so it is unit-testable and so the rule below cannot
// be bypassed by a surface that happens to import the UI layer first.

import type { ExecutionRecord, ExecutionState } from './executionState.js';

/**
 * What a surface is allowed to claim.
 *
 * `success` is the ONLY value that may be rendered as an unqualified completion.
 * Everything else must be visibly qualified.
 */
export type OutcomeSeverity =
  | 'success'
  /** The Brain finished, but the terminal revision was not written. Real work may
   * have happened; we simply cannot prove it survived. Never shown as success. */
  | 'degraded_completion'
  | 'cancelled'
  /** Cancellation was requested and never acknowledged — the work may still be
   * running somewhere. The most dangerous state to render optimistically. */
  | 'unverified'
  | 'failure'
  /** Not terminal at all: running, connecting, degraded. */
  | 'in_progress';

export interface OutcomePresentation {
  readonly severity: OutcomeSeverity;
  /** The sentence, already qualified. Never optimistic. */
  readonly message: string;
  /** `op <id> · rev N` — or `rev unrecorded` when nothing was durably written. */
  readonly stamp: string;
  /** message + stamp, for surfaces that render a single string. */
  readonly text: string;
  readonly operationId: string;
  readonly revision?: number;
  readonly state: ExecutionState;
  readonly durable: boolean;
}

/** The minimum a surface needs. Accepts a governed outcome or an error's record. */
export interface PresentableOutcome {
  readonly record: ExecutionRecord;
  readonly statusLine: string;
  readonly durable: boolean;
  readonly revision?: number;
}

/** `rev unrecorded` is load-bearing: an unstamped surface is indistinguishable from
 * a stamped one that lost its write, and the operator must be able to tell. */
export function stampOf(operationId: string, revision?: number): string {
  return `op ${operationId} · rev ${revision === undefined ? 'unrecorded' : String(revision)}`;
}

/**
 * The success gate, in one place.
 *
 * All three conditions are required. `terminalObserved` without `durable` means we
 * saw the answer but cannot prove we recorded it; `durable` without
 * `terminalObserved` cannot occur, but is rejected rather than assumed impossible.
 */
export function qualifiesAsSuccess(record: ExecutionRecord, durable: boolean): boolean {
  return record.state === 'completed' && record.terminalObserved === true && durable === true;
}

function severityOf(record: ExecutionRecord, durable: boolean): OutcomeSeverity {
  if (qualifiesAsSuccess(record, durable)) return 'success';
  switch (record.state) {
    case 'completed':
      // Completed but not provable. Distinct from failure — the work may well have
      // been done — and distinct from success, which we cannot honestly claim.
      return 'degraded_completion';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return record.failureCategory === 'cancellation_unconfirmed' ||
        record.failureCategory === 'terminal_state_unverified'
        ? 'unverified'
        : 'failure';
    default:
      return 'in_progress';
  }
}

const QUALIFIER: Record<OutcomeSeverity, (line: string) => string> = {
  success: (line) => line,
  degraded_completion: () =>
    'Completed, but not durably recorded — the outcome will not survive a restart. Treat as unconfirmed.',
  cancelled: (line) => line,
  unverified: (line) => `${line} — the work may still be running. Verify before re-running.`,
  failure: (line) => line,
  in_progress: (line) => line,
};

/** Render an outcome. This is the only sanctioned way to describe one to a user. */
export function presentOutcome(outcome: PresentableOutcome): OutcomePresentation {
  const { record, durable } = outcome;
  const severity = severityOf(record, durable);
  const message = QUALIFIER[severity](outcome.statusLine);
  const stamp = stampOf(record.operationId, outcome.revision);
  return {
    severity,
    message,
    stamp,
    text: `${message} [${stamp}]`,
    operationId: record.operationId,
    ...(outcome.revision === undefined ? {} : { revision: outcome.revision }),
    state: record.state,
    durable,
  };
}

/** Status-bar affordances, derived from severity so no surface re-decides colour. */
export function statusBarFor(p: OutcomePresentation): {
  text: string;
  tooltip: string;
  warning: boolean;
  error: boolean;
} {
  const icon =
    p.severity === 'success'
      ? '$(check)'
      : p.severity === 'in_progress'
        ? '$(sync~spin)'
        : p.severity === 'failure'
          ? '$(error)'
          : '$(warning)';
  const label: Record<OutcomeSeverity, string> = {
    success: 'done',
    degraded_completion: 'done (unrecorded)',
    cancelled: 'cancelled',
    unverified: 'unconfirmed',
    failure: 'failed',
    in_progress: 'working',
  };
  return {
    text: `${icon} MigraPilot: ${label[p.severity]}`,
    tooltip: p.text,
    warning: p.severity === 'degraded_completion' || p.severity === 'unverified',
    error: p.severity === 'failure',
  };
}

/**
 * Which vscode notification API a severity maps to. Success is the ONLY info-level
 * outcome; everything else must be visibly qualified.
 *
 * Lives here rather than beside the `vscode` import so the mapping stays unit-testable
 * — the same reason the persister does not live in the vscode-coupled module.
 */
export function notificationApiFor(
  p: OutcomePresentation,
): 'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage' {
  switch (p.severity) {
    case 'success':
      return 'showInformationMessage';
    case 'failure':
      return 'showErrorMessage';
    default:
      // degraded_completion, unverified, cancelled, in_progress.
      return 'showWarningMessage';
  }
}
