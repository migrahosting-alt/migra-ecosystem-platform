// MigraPilot Shell — RunHistoryList + RunDetailPanel (§9, §10).
//
// HISTORY IS EVIDENCE ONLY. Every model in this file is built through
// `historyControlAvailability()`, whose approve/reject/cancel/freshProposal
// fields are constant `false`, so a terminal record structurally cannot grow an
// execution control. The only affordances offered are evidence reads (inspect,
// export).
//
// The models also exclude the fields the proposal card excludes — a history
// record never displays a preview fingerprint or a snapshot manifest digest.

import type { AgentModeRunHistoryDetail, AgentModeRunHistoryList, AgentModeRunHistorySummary } from '@migrapilot/protocol';
import { executableLabel, pathLabel } from './proposalCardModel.js';
import {
  approvalBadge,
  historyControlAvailability,
  integrityBadge,
  recoveryBadge,
  runStateBadge,
  type RunControls,
} from './runStateModel.js';
import { type ActionButton, type Badge, type Row, formatDuration, optionalRow, relativeAge, shortenId } from './types.js';

export interface RunHistoryRow {
  runId: string;
  runIdShort: string;
  recipe: string;
  age: string;
  state: Badge;
  approval: Badge;
  recovery: Badge;
  integrity: Badge;
  /** Always the evidence-only control set. */
  controls: RunControls;
  actions: ActionButton[];
}

export interface RunHistoryListModel {
  state: 'ready' | 'empty' | 'activation-required' | 'disconnected' | 'loading';
  rows: RunHistoryRow[];
  /** Retention governance is READ_ONLY in the protocol; surfaced for the operator. */
  retentionNote?: string;
  message?: string;
  /** Present when the engine returned a paging cursor. */
  hasMore: boolean;
}

const EVIDENCE_ACTIONS: readonly ActionButton[] = [
  { id: 'inspectEvidence', label: 'Inspect evidence', kind: 'secondary', icon: 'search' },
  { id: 'exportEvidence', label: 'Export evidence', kind: 'secondary', icon: 'desktop-download' },
];

export function toRunHistoryList(list: AgentModeRunHistoryList | undefined, now: number, error?: { kind: 'activation' | 'transport'; message: string }): RunHistoryListModel {
  if (error) {
    return {
      state: error.kind === 'activation' ? 'activation-required' : 'disconnected',
      rows: [],
      message: error.message,
      hasMore: false,
    };
  }
  if (!list) return { state: 'loading', rows: [], message: 'Loading run history…', hasMore: false };
  if (!list.runs.length) {
    return {
      state: 'empty',
      rows: [],
      message: 'No Agent Mode runs recorded for this workspace.',
      retentionNote: retentionNote(list),
      hasMore: false,
    };
  }
  return {
    state: 'ready',
    rows: list.runs.map((run) => toRunHistoryRow(run, now)),
    retentionNote: retentionNote(list),
    hasMore: Boolean(list.nextCursor),
  };
}

function retentionNote(list: AgentModeRunHistoryList): string {
  const days = Math.round(list.retention.terminalRetentionMs / 86_400_000);
  return `Evidence only · retention governance ${list.retention.governance} · terminal runs kept ${days > 0 ? `${days}d` : formatDuration(list.retention.terminalRetentionMs / 1000)} · ${list.retention.tombstoneCount} tombstones`;
}

export function toRunHistoryRow(run: AgentModeRunHistorySummary, now: number): RunHistoryRow {
  return {
    runId: run.runId,
    runIdShort: shortenId(run.runId),
    recipe: run.recipe,
    age: relativeAge(run.terminalAt ?? run.updatedAt, now),
    state: runStateBadge(run.state),
    approval: approvalBadge(run.approvalLifecycle),
    recovery: recoveryBadge(run.recoveryClass),
    integrity: integrityBadge(run.integrity, run.integrityIssues),
    controls: historyControlAvailability(),
    actions: EVIDENCE_ACTIONS.map((action) => ({ ...action })),
  };
}

// ── Run detail (evidence) ─────────────────────────────────────────────────────

export interface RunDetailModel {
  state: 'ready' | 'empty';
  runId: string;
  runIdShort: string;
  badges: Badge[];
  /** Grouped, sanitized evidence rows. */
  sections: Array<{ title: string; rows: Row[] }>;
  timeline: Array<{ seq: number; at: string; type: string; transition: string; reason?: string; source: string }>;
  /** Evidence-only. No approve / resume / execute / cancel — ever. */
  controls: RunControls;
  actions: ActionButton[];
  /** Explicit banner text so the operator can see why there are no controls. */
  evidenceNote: string;
}

export const EVIDENCE_ONLY_NOTE =
  'This is a durable evidence record. History cannot approve, resume, execute, or cancel a run.';

export function toRunDetail(detail: AgentModeRunHistoryDetail | undefined, now: number): RunDetailModel {
  if (!detail) {
    return {
      state: 'empty',
      runId: '',
      runIdShort: '—',
      badges: [],
      sections: [],
      timeline: [],
      controls: historyControlAvailability(),
      actions: [],
      evidenceNote: EVIDENCE_ONLY_NOTE,
    };
  }
  const { summary, preview, result, error, lineage, recovery, retention } = detail;

  const sections: Array<{ title: string; rows: Row[] }> = [
    {
      title: 'Run',
      rows: [
        { label: 'Run', value: summary.runId, tone: 'muted', mono: true },
        { label: 'Request', value: shortenId(summary.requestId), tone: 'muted', mono: true },
        { label: 'State', value: summary.state, tone: runStateBadge(summary.state).tone },
        { label: 'Recipe', value: summary.recipe, tone: 'info', mono: true },
        { label: 'Requested', value: relativeAge(summary.requestedAt, now) },
        optionalRow('Terminal', summary.terminalAt === undefined ? undefined : relativeAge(summary.terminalAt, now)),
        { label: 'Events', value: String(summary.eventCount) },
      ],
    },
    {
      title: 'Governance',
      rows: [
        { label: 'Approval', value: summary.approvalLifecycle, tone: approvalBadge(summary.approvalLifecycle).tone },
        { label: 'Recovery', value: summary.recoveryClass, tone: recoveryBadge(summary.recoveryClass).tone },
        {
          label: 'Fresh proposal',
          value: summary.recoveryEligible ? 'allowed' : 'not allowed',
          tone: summary.recoveryEligible ? 'warn' : 'muted',
        },
        optionalRow('Recovery reason', summary.recoveryReason),
        { label: 'Integrity', value: summary.integrity, tone: integrityBadge(summary.integrity, summary.integrityIssues).tone },
        ...(summary.integrityIssues.length
          ? [{ label: 'Integrity issues', value: summary.integrityIssues.join('; '), tone: 'error' as const }]
          : []),
        { label: 'Mutation', value: summary.mutationClassification, tone: summary.mutationClassification === 'read-only' ? 'ok' : 'governed' },
        { label: 'Network', value: summary.networkPolicy },
      ],
    },
  ];

  if (preview) {
    // Sanitized: basename-only executable/cwd; NO fingerprint, NO snapshot id.
    sections.push({
      title: 'Executed recipe',
      rows: [
        optionalRow('Policy version', preview.policyVersion, undefined, true),
        optionalRow('Execution identity', preview.executionIdentity),
        optionalRow('Environment policy', preview.environmentPolicy),
        optionalRow('Executable', executableLabel(preview.executable), undefined, true),
        optionalRow('Working directory', pathLabel(preview.cwd), undefined, true),
        { label: 'Can modify files', value: preview.canModifyFiles ? 'yes' : 'no', tone: preview.canModifyFiles ? 'governed' : 'ok' },
        ...preview.expectedEffects.map((effect, index) => ({ label: `Expected effect ${index + 1}`, value: effect })),
      ],
    });
  }

  if (result) {
    sections.push({
      title: 'Result',
      rows: [
        { label: 'Exit code', value: result.exitCode === null ? 'none' : String(result.exitCode), tone: result.exitCode === 0 ? 'ok' : 'warn' },
        { label: 'Timed out', value: result.timedOut ? 'yes' : 'no', tone: result.timedOut ? 'warn' : 'muted' },
        { label: 'Truncated', value: result.truncated ? 'yes' : 'no', tone: 'muted' },
        { label: 'Redacted', value: result.redacted ? 'yes' : 'no', tone: result.redacted ? 'ok' : 'muted' },
        { label: 'Duration', value: formatDuration(result.durationMs / 1000) },
      ],
    });
  }

  if (error) {
    sections.push({ title: 'Failure', rows: [{ label: error.code, value: error.message, tone: 'error' }] });
  }

  sections.push({
    title: 'Lineage & retention',
    rows: [
      optionalRow('Source run', lineage.sourceRunId ? shortenId(lineage.sourceRunId) : undefined, undefined, true),
      optionalRow('Successor run', lineage.successorRunId ? shortenId(lineage.successorRunId) : undefined, undefined, true),
      optionalRow('Recovery recommendation', recovery?.recommendedAction),
      { label: 'Eligible for deletion', value: retention.eligibleForDeletion ? 'yes' : 'no', tone: 'muted' },
      { label: 'Retention reason', value: retention.reason, tone: 'muted' },
      ...(retention.tombstone
        ? [{ label: 'Tombstone final state', value: retention.tombstone.finalState, tone: 'muted' as const }]
        : []),
    ],
  });

  return {
    state: 'ready',
    runId: summary.runId,
    runIdShort: shortenId(summary.runId),
    badges: [
      runStateBadge(summary.state),
      approvalBadge(summary.approvalLifecycle),
      recoveryBadge(summary.recoveryClass),
      integrityBadge(summary.integrity, summary.integrityIssues),
    ],
    sections,
    timeline: detail.timeline.map((event) => ({
      seq: event.seq,
      at: relativeAge(event.at, now),
      type: event.type,
      transition: `${event.priorState ?? '—'} → ${event.nextState}`,
      ...(event.reason ? { reason: event.reason } : {}),
      source: event.source,
    })),
    controls: historyControlAvailability(),
    actions: EVIDENCE_ACTIONS.map((action) => ({ ...action })),
    evidenceNote: EVIDENCE_ONLY_NOTE,
  };
}

/**
 * The evidence-export confirmation view. The manifest digest is a SHA-256 of the
 * sanitized evidence body — a snapshot manifest digest is exactly what §1 forbids
 * displaying, so the shell reports the byte count and schema version and offers
 * to save the file; the digest itself stays in the saved artefact.
 */
export interface EvidenceExportSummary {
  runIdShort: string;
  rows: Row[];
}

export function toEvidenceExportSummary(exported: { runId: string; manifest: { canonicalBytes: number; schemaVersion: number; redaction: string; algorithm: string } }): EvidenceExportSummary {
  return {
    runIdShort: shortenId(exported.runId),
    rows: [
      { label: 'Run', value: shortenId(exported.runId), tone: 'muted', mono: true },
      { label: 'Bytes', value: String(exported.manifest.canonicalBytes), mono: true },
      { label: 'Schema version', value: String(exported.manifest.schemaVersion), mono: true },
      { label: 'Digest algorithm', value: exported.manifest.algorithm, mono: true },
      { label: 'Redaction', value: exported.manifest.redaction, tone: 'ok' },
    ],
  };
}
