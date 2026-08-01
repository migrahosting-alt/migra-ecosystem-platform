// MigraPilot — presentation model for the governed coding surface.
//
// Everything the VS Code layer DISPLAYS is computed here, and computed from the
// Brain snapshot alone. The editor layer above this owns windows and buttons; it
// owns no judgement about what a run did.
//
// That split exists because every display bug in this area is the same bug: a
// surface that knows something the durable record does not. A local timer that
// decides a run is "probably done", a panel that keeps the last phase after the
// connection drops, a Cancel button that writes "Cancelled" on click. Keeping the
// computation here — pure, vscode-free — makes each of those a test rather than a
// screenshot.

import type { CodingRunSnapshot } from './codingRunClient.js';
import { cancellationLabel } from './codingRunClient.js';

// ── phase presentation ───────────────────────────────────────────────────────

export interface PhaseView {
  label: string;
  /** True while the Brain is still working. Drives spinners, never a timer. */
  busy: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  planning: 'Planning',
  awaiting_scope_approval: 'Awaiting approval',
  executing_initial_changeset: 'Applying changes',
  validating: 'Validating',
  repairing: 'Repairing',
  reconciling: 'Reconciling',
};

const TERMINAL_STATE_LABELS: Record<string, string> = {
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  STALE: 'Stale',
};

/**
 * The single status line.
 *
 * A cancellation label always wins: while a cancellation is pending the run's
 * phase is still moving, and showing "Validating" to someone who pressed Cancel
 * reads as the request having been ignored.
 */
export function phaseView(snapshot: CodingRunSnapshot): PhaseView {
  const cancellation = cancellationLabel(snapshot);
  if (cancellation) {
    return { label: cancellation, busy: cancellation === 'Cancellation requested' };
  }
  if (snapshot.phase === 'terminal') {
    return { label: TERMINAL_STATE_LABELS[snapshot.state] ?? snapshot.state, busy: false };
  }
  return { label: PHASE_LABELS[snapshot.phase] ?? snapshot.phase, busy: true };
}

/** Consequential child outcomes, in plain language. Never raw internals. */
const CHILD_LABELS: Record<string, string> = {
  repository_planning: 'Read the repository',
  initial_model_proposal: 'Proposed changes',
  initial_apply: 'Applied changes',
  validation: 'Ran validation',
  repair_model_proposal: 'Proposed a repair',
  repair_apply: 'Applied the repair',
  final_validation: 'Final validation',
  reconciliation: 'Reconciled against the repository',
};

export interface ChildView {
  label: string;
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'running' | 'pending';
  attempt: number;
}

export function childViews(snapshot: CodingRunSnapshot): ChildView[] {
  return snapshot.children.map((child) => ({
    label: CHILD_LABELS[child.kind] ?? child.kind,
    attempt: child.attempt,
    outcome:
      child.state === 'completed' ? 'succeeded'
        : child.state === 'failed' ? 'failed'
          : child.state === 'cancelled' ? 'cancelled'
            : child.state === 'interrupted' ? 'interrupted'
              : child.state === 'running' || child.state === 'cancelling' ? 'running'
                : 'pending',
  }));
}

// ── approval presentation ────────────────────────────────────────────────────

export interface ApprovalDocument {
  title: string;
  markdown: string;
  /** Repeated in the modal so a decision cannot be made from the title alone. */
  modalDetail: string;
}

/**
 * The approval document.
 *
 * Shows the exact path set, why each file is in it, and WHERE the evidence came
 * from — an operator approving write authority over a file is entitled to see the
 * lines that justified it. The scope hash and expiry are shown because they are
 * what the decision is bound to, and the superseded warning is prominent because
 * silently re-presenting a changed proposal is how an approval gets misapplied.
 */
export function approvalDocument(input: {
  runId: string;
  revision: number;
  pathSetHash: string;
  expiresAt: string;
  issueSummary?: string;
  files: Array<{ path: string; rationale: string; evidence: Array<{ startLine: number; endLine: number; excerptHash: string }> }>;
  excluded: Array<{ path: string; reason: string }>;
  supersededPreviousProposal?: boolean;
}): ApprovalDocument {
  const lines: string[] = [];
  lines.push(`# Governed coding — approve file scope`);
  lines.push('');
  if (input.supersededPreviousProposal) {
    lines.push('> ⚠️ **This proposal REPLACED the one you were shown earlier.** The file scope changed, so your previous decision does not apply. Review it again before approving.');
    lines.push('');
  }
  if (input.issueSummary) {
    lines.push(`**Issue:** ${input.issueSummary}`);
    lines.push('');
  }
  lines.push(`MigraPilot may write to **exactly these ${input.files.length} file(s)** and no others.`);
  lines.push('');
  for (const file of input.files) {
    lines.push(`### \`${file.path}\``);
    lines.push(file.rationale || '_(no rationale recorded)_');
    if (file.evidence.length) {
      const spans = file.evidence.map((s) => `lines ${s.startLine}–${s.endLine}`).join(', ');
      lines.push(`- Evidence read from \`${file.path}\`: ${spans}`);
    } else {
      lines.push('- ⚠️ No evidence spans recorded for this file.');
    }
    lines.push('');
  }
  if (input.excluded.length) {
    lines.push('### Considered and excluded');
    for (const entry of input.excluded) lines.push(`- \`${entry.path}\` — ${entry.reason}`);
    lines.push('');
  }
  lines.push('---');
  lines.push(`- **Scope hash:** \`${input.pathSetHash}\``);
  lines.push(`- **Revision:** ${input.revision}`);
  lines.push(`- **Approval expires:** ${input.expiresAt}`);
  lines.push(`- **Run:** \`${input.runId}\``);
  lines.push('');
  lines.push('If the proposed scope changes for any reason, this approval stops applying and you will be asked again.');

  return {
    title: `Approve coding scope — ${input.files.length} file(s)`,
    markdown: lines.join('\n'),
    modalDetail:
      `${input.supersededPreviousProposal ? 'THIS PROPOSAL REPLACED AN EARLIER ONE.\n\n' : ''}` +
      `MigraPilot may write to exactly these files:\n\n${input.files.map((f) => `  • ${f.path}`).join('\n')}\n\n` +
      `Scope hash ${input.pathSetHash} · expires ${input.expiresAt}\n\n` +
      'Any change to this scope requires a new decision.',
  };
}

// ── final report ─────────────────────────────────────────────────────────────

/**
 * The final report, rendered from the Brain's durable record.
 *
 * Nothing here is computed locally — not the completion state, not the file list,
 * not whether validation passed. The extension's job is to show the record, and a
 * report assembled from local assumptions is exactly the artifact this project has
 * spent every slice making impossible.
 */
export function finalReportDocument(snapshot: CodingRunSnapshot): string {
  const report = snapshot.finalReport;
  const lines: string[] = [];
  const status = phaseView(snapshot);
  lines.push(`# Governed coding — ${status.label}`);
  lines.push('');
  lines.push(`Run \`${snapshot.runId}\` · revision ${snapshot.revision} · state \`${snapshot.state}\``);
  lines.push('');

  if (!report) {
    lines.push('_The Brain recorded no final report for this run._');
    if (snapshot.blockers.length) {
      lines.push('');
      lines.push('## Blocked by');
      for (const blocker of snapshot.blockers) lines.push(`- ${blocker}`);
    }
    return lines.join('\n');
  }

  lines.push(`**Complete:** ${report.complete ? 'yes' : 'no'} · **Stop reason:** \`${report.stopReason}\``);
  lines.push('');
  lines.push('## Files');
  lines.push(`- **Approved scope:** ${list(report.approvedPaths)}`);
  lines.push(`- **Changed (git diff, authoritative):** ${list(report.changedFiles)}`);
  if (report.refusedPaths.length) lines.push(`- **Refused (outside authority):** ${list(report.refusedPaths)}`);
  if (report.unusedScope.length) lines.push(`- **Approved but never written:** ${list(report.unusedScope)}`);
  lines.push('');

  const validations = snapshot.children.filter((c) => c.kind === 'validation' || c.kind === 'final_validation');
  if (validations.length) {
    lines.push('## Validation');
    for (const v of validations) {
      const verdict = v.terminalCategory === 'observed_success' ? 'passed' : v.terminalCategory === 'observed_failure' ? 'failed' : v.state;
      lines.push(`- ${CHILD_LABELS[v.kind] ?? v.kind} (attempt ${v.attempt}): **${verdict}**`);
    }
    if (snapshot.latestValidation) {
      lines.push(`- Command: \`${snapshot.latestValidation.command.join(' ')}\` → exit ${snapshot.latestValidation.exitCode ?? 'null'}`);
    }
    lines.push('');
  }

  const repairs = snapshot.children.filter((c) => c.kind === 'repair_model_proposal' || c.kind === 'repair_apply');
  if (repairs.length) {
    lines.push('## Repairs');
    for (const r of repairs) {
      lines.push(`- ${CHILD_LABELS[r.kind] ?? r.kind} (attempt ${r.attempt}): ${r.terminalCategory ?? r.state}`);
    }
    lines.push('');
  }

  if (report.unresolvedRisks.length) {
    lines.push('## Unresolved risks');
    for (const risk of report.unresolvedRisks) lines.push(`- ${risk}`);
    lines.push('');
  }
  if (snapshot.blockers.length) {
    lines.push('## Completion blocked by');
    for (const blocker of snapshot.blockers) lines.push(`- ${blocker}`);
  }
  return lines.join('\n');
}

function list(paths: readonly string[]): string {
  return paths.length ? paths.map((p) => `\`${p}\``).join(', ') : '_none_';
}

// ── reload recovery ──────────────────────────────────────────────────────────

export type ReloadDecision =
  | { kind: 'restore_progress'; snapshot: CodingRunSnapshot }
  | { kind: 'restore_approval'; snapshot: CodingRunSnapshot }
  | { kind: 'show_final'; snapshot: CodingRunSnapshot }
  | { kind: 'run_missing' }
  | { kind: 'capability_unavailable'; detail: string }
  | { kind: 'unreadable'; detail: string }
  | { kind: 'unknown'; detail: string }
  | { kind: 'nothing_to_restore' };

/**
 * What to do with a remembered run after the window reloads.
 *
 * The extension restarting says NOTHING about the run. A run that was validating
 * when the window closed is still validating, or finished, or failed — only the
 * Brain knows, so this always asks. `run_missing` and `capability_unavailable` stay
 * distinct because "your run is gone" and "this Brain cannot do coding runs" lead a
 * user to completely different actions.
 */
export function decideReload(input: {
  storedRunId?: string;
  capability?: { available: boolean; unavailableReason?: string };
  lookup:
    | { kind: 'ok'; value: CodingRunSnapshot }
    | { kind: 'not_found' }
    | { kind: 'corrupt'; detail: string }
    | { kind: 'capability_unavailable'; detail: string }
    | { kind: 'other'; detail: string };
}): ReloadDecision {
  if (!input.storedRunId) return { kind: 'nothing_to_restore' };
  if (input.capability && !input.capability.available) {
    return { kind: 'capability_unavailable', detail: input.capability.unavailableReason ?? 'Governed coding is not available on this Brain.' };
  }
  switch (input.lookup.kind) {
    case 'not_found': return { kind: 'run_missing' };
    case 'corrupt': return { kind: 'unreadable', detail: input.lookup.detail };
    case 'capability_unavailable': return { kind: 'capability_unavailable', detail: input.lookup.detail };
    case 'other': return { kind: 'unknown', detail: input.lookup.detail };
    case 'ok': {
      const snapshot = input.lookup.value;
      if (snapshot.phase === 'terminal') return { kind: 'show_final', snapshot };
      if (snapshot.phase === 'awaiting_scope_approval') return { kind: 'restore_approval', snapshot };
      return { kind: 'restore_progress', snapshot };
    }
  }
}

/** Closing the panel is not a cancellation. Stated as a function so the editor
 * layer cannot express the alternative. */
export function panelClosureCancelsRun(): false {
  return false;
}
