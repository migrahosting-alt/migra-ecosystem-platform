// MigraPilot Shell — ProposalCard + ValidationSummary + AgentProgress.
//
// SECURITY-RELEVANT SANITATION. The webview receives ONLY what this module
// returns, so the deny-list below is the enforcement point for §1:
//
//   never displayed → preview.fingerprint            (approval authority)
//                     preview.snapshotId             (snapshot manifest digest)
//                     preview.workspaceMaterialFingerprint
//                     preview.environment[].value    (environment values)
//                     preview.executable (full path) (raw sensitive path)
//                     preview.cwd        (full path) (raw sensitive path)
//                     preview.sourceWorkspace (full path)
//
// The fingerprint never crosses into the webview at all: the host binds a
// decision to the fingerprint it already holds authoritatively, and the webview
// sends only a bare `approve` / `reject` intent.

import type { AgentModeCommandPreview, AgentModeCommandRunView, AgentModeRunHistoryEvent, AgentModeState } from '@migrapilot/protocol';
import { approvalBadge, riskBadge, runControlAvailability, runStateBadge, type RunControls } from './runStateModel.js';
import { type ActionButton, type Badge, type Row, formatDuration, optionalRow, shortenId } from './types.js';

/** Fields that must never reach the webview, asserted by a unit test. */
export const PROPOSAL_DENY_LIST: readonly string[] = [
  'fingerprint',
  'snapshotId',
  'workspaceMaterialFingerprint',
  'activationCapability',
  'bootstrapSecret',
];

/** Last path segment only — keeps a full filesystem path out of the UI. */
export function pathLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : undefined;
}

/** `git` from `/usr/bin/git`, `git.exe` from `C:\Program Files\Git\git.exe`. */
export function executableLabel(value: string | undefined): string | undefined {
  return pathLabel(value);
}

export type ValidationOutcome = 'passed' | 'failed' | 'planned' | 'not-run';

export interface ValidationCheck {
  name: string;
  outcome: ValidationOutcome;
  /** Canonical detail (e.g. "21 passing"). Absent when the engine reported none. */
  detail?: string;
}

export interface ValidationSummary {
  /** `not-run` renders the explicit "Not run yet" state required by §8. */
  state: 'not-run' | 'reported';
  checks: ValidationCheck[];
  note: string;
}

export interface ProposalChangeSummary {
  /** Canonical counts. `undefined` (not 0) when the engine reported none. */
  fileCount?: number;
  additions?: number;
  deletions?: number;
  files: Array<{ path: string; operation: string }>;
  /** Server-declared effects — the authoritative description of what will happen. */
  expectedEffects: string[];
  note: string;
}

export interface ProposalCard {
  /** Header */
  heading: string;
  runIdShort: string;
  runId: string;
  risk: Badge;
  governance: Badge;
  state: Badge;
  approval: Badge;
  /** Human-readable task summary (the operator-supplied reason). */
  task: string;
  changes: ProposalChangeSummary;
  validation: ValidationSummary;
  /** Policy + execution rows (sanitized). */
  policy: Row[];
  /** Environment keys ONLY — never values. */
  environmentKeys: Row[];
  warnings: string[];
  actions: ActionButton[];
  controls: RunControls;
  /** Remaining approval window, when the engine reported an expiry. */
  expiresInLabel?: string;
}

const GOVERNED_BADGE: Badge = {
  text: 'AGENT MODE: GOVERNED',
  tone: 'governed',
  title: 'Every command runs through the server-owned proposal and one-time approval boundary.',
};

/**
 * Map an authoritative run view into the sanitized proposal card.
 *
 * `now` is injected so the expiry countdown is deterministic in tests.
 */
export function toProposalCard(view: AgentModeCommandRunView, now: number): ProposalCard {
  const preview = view.preview;
  const controls = runControlAvailability(view);
  const expiresAt = view.approval?.expiresAt ?? preview?.expiresAt;
  const remainingSec = expiresAt !== undefined ? Math.max(0, Math.round((expiresAt - now) / 1000)) : undefined;

  return {
    heading: headingFor(view.state),
    runIdShort: shortenId(view.runId),
    runId: view.runId,
    risk: riskBadge(preview?.mutationClassification, preview?.canModifyFiles),
    governance: GOVERNED_BADGE,
    state: runStateBadge(view.state),
    approval: approvalBadge(view.approval?.lifecycle),
    task: preview?.reason?.trim() || 'The engine did not report a task summary for this proposal.',
    changes: toChangeSummary(preview),
    validation: toValidationSummary(),
    policy: toPolicyRows(preview, view),
    environmentKeys: toEnvironmentRows(preview),
    warnings: preview?.warnings ? [...preview.warnings] : [],
    actions: toProposalActions(controls),
    controls,
    ...(remainingSec !== undefined ? { expiresInLabel: remainingSec > 0 ? `Expires in ${formatDuration(remainingSec)}` : 'Approval window closed' } : {}),
  };
}

function headingFor(state: AgentModeState): string {
  switch (state) {
    case 'AWAITING_APPROVAL':
      return 'PROPOSAL READY';
    case 'PLANNING':
      return 'PREPARING PROPOSAL';
    case 'APPROVED':
      return 'APPROVED — AWAITING EXECUTION';
    case 'EXECUTING':
      return 'EXECUTING';
    case 'COMPLETED':
      return 'RUN COMPLETED';
    case 'REJECTED':
      return 'PROPOSAL REJECTED';
    case 'EXPIRED':
      return 'PROPOSAL EXPIRED';
    case 'STALE':
      return 'PROPOSAL STALE';
    case 'CANCELLED':
      return 'RUN CANCELLED';
    case 'FAILED':
      return 'RUN FAILED';
    case 'IDLE':
      return 'NO ACTIVE PROPOSAL';
  }
}

/**
 * The current server-owned recipes are read-only Git inspections, so they
 * propose NO file changes. Rather than invent a file list, report the engine's
 * own classification and expected effects. `fileCount` stays `undefined` so the
 * renderer shows an em dash instead of a fabricated `0 files changed`.
 */
function toChangeSummary(preview: AgentModeCommandPreview | undefined): ProposalChangeSummary {
  if (!preview) {
    return { files: [], expectedEffects: [], note: 'No server-issued preview is available yet.' };
  }
  const readOnly = preview.mutationClassification === 'read-only' && preview.canModifyFiles === false;
  return {
    files: [],
    expectedEffects: [...preview.expectedEffects],
    note: readOnly
      ? 'No file changes are proposed — the engine classified this recipe as read-only and it cannot modify workspace files.'
      : 'The engine reported that this recipe may write to the workspace. Review the expected effects before approving.',
  };
}

/**
 * There is no canonical validation surface on an Agent Mode command run, so the
 * card reports the honest "Not run yet" state. It NEVER claims a check passed
 * from model-generated text (§8).
 */
function toValidationSummary(): ValidationSummary {
  return {
    state: 'not-run',
    checks: [],
    note: 'Not run yet — the engine has not reported validation for this run.',
  };
}

function toPolicyRows(preview: AgentModeCommandPreview | undefined, view: AgentModeCommandRunView): Row[] {
  const rows: Row[] = [
    optionalRow('Recipe', preview?.recipe, 'info', true),
    optionalRow('Policy version', preview?.policyVersion, undefined, true),
    optionalRow('Execution identity', preview?.executionIdentity),
    optionalRow('Environment policy', preview?.environmentPolicy),
    // Basename only — never the full executable path.
    optionalRow('Executable', executableLabel(preview?.executable), undefined, true),
    optionalRow('Working directory', pathLabel(preview?.cwd), undefined, true),
    optionalRow('Workspace', pathLabel(preview?.sourceWorkspace), undefined, true),
    optionalRow('Mutation', preview?.mutationClassification, preview?.mutationClassification === 'read-only' ? 'ok' : 'governed'),
    optionalRow('Network', preview?.networkPolicy),
    optionalRow('Can modify files', preview ? (preview.canModifyFiles ? 'yes' : 'no') : undefined, preview?.canModifyFiles ? 'governed' : 'ok'),
    optionalRow('Timeout', preview ? `${preview.timeoutMs} ms` : undefined),
    optionalRow('Output limit', preview ? `${preview.outputLimitBytes} bytes` : undefined),
    { label: 'Approval requirement', value: 'Explicit one-time approval', tone: 'governed' },
    optionalRow('Request', shortenId(view.requestId), undefined, true),
  ];
  return rows;
}

/** Environment KEYS with a redaction flag. Values never leave the host. */
function toEnvironmentRows(preview: AgentModeCommandPreview | undefined): Row[] {
  if (!preview?.environment?.length) return [];
  return preview.environment.map((entry) => ({
    label: entry.key,
    value: entry.redacted ? 'redacted by policy' : 'set by policy',
    tone: 'muted' as const,
    mono: true,
  }));
}

function toProposalActions(controls: RunControls): ActionButton[] {
  return [
    {
      id: 'reviewDiff',
      label: 'Review Diff',
      kind: 'primary',
      icon: 'diff',
      disabled: !controls.reviewDiff,
      ...(controls.reviewDiff ? {} : { disabledReason: 'No server-issued preview is available to review.' }),
    },
    {
      id: 'reject',
      label: 'Reject',
      kind: 'danger',
      icon: 'circle-slash',
      disabled: !controls.reject,
      ...(controls.reject ? {} : { disabledReason: 'Only a proposal awaiting approval can be rejected.' }),
    },
    {
      id: 'approve',
      label: 'Approve & Run',
      kind: 'governed',
      icon: 'shield',
      disabled: !controls.approve,
      ...(controls.approve ? {} : { disabledReason: 'Approval requires a live proposal awaiting approval.' }),
    },
  ];
}

// ── AgentProgress ─────────────────────────────────────────────────────────────

export type StageStatus = 'pending' | 'active' | 'complete' | 'failed' | 'skipped';

export interface ProgressStage {
  id: string;
  label: string;
  status: StageStatus;
  /** Canonical detail (the backend event reason), when reported. */
  detail?: string;
}

/** Ordered lifecycle used to decide which stages the backend has passed. */
const STAGE_ORDER: ReadonlyArray<{ id: string; label: string; states: readonly AgentModeState[] }> = [
  { id: 'queued', label: 'Request accepted', states: ['PLANNING', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'COMPLETED'] },
  { id: 'planning', label: 'Proposal prepared', states: ['AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'COMPLETED'] },
  { id: 'approval', label: 'Approval recorded', states: ['APPROVED', 'EXECUTING', 'COMPLETED'] },
  { id: 'executing', label: 'Recipe executed', states: ['COMPLETED'] },
  { id: 'validating', label: 'Evidence recorded', states: ['COMPLETED'] },
];

/** Which stage a state is currently sitting in. */
const ACTIVE_STAGE: Partial<Record<AgentModeState, string>> = {
  PLANNING: 'planning',
  AWAITING_APPROVAL: 'approval',
  APPROVED: 'executing',
  EXECUTING: 'executing',
};

/**
 * Build the progress list from AUTHORITATIVE state only.
 *
 * A stage is `complete` strictly because the backend has advanced past it — it
 * is never inferred from streamed model text (§7). Timeline events, when
 * available, supply the canonical `detail` for a stage.
 */
export function toProgressStages(
  view: AgentModeCommandRunView | undefined,
  timeline: readonly AgentModeRunHistoryEvent[] = [],
): ProgressStage[] {
  if (!view) return [];
  const state = view.state;
  const failed = state === 'FAILED' || state === 'REJECTED' || state === 'CANCELLED' || state === 'EXPIRED' || state === 'STALE';
  const activeId = ACTIVE_STAGE[state];
  const detailByStage = stageDetails(timeline);

  return STAGE_ORDER.map((stage) => {
    const complete = stage.states.includes(state);
    let status: StageStatus = 'pending';
    if (complete) status = 'complete';
    else if (stage.id === activeId) status = 'active';
    else if (failed && !complete) status = 'skipped';
    if (failed && stage.id === activeId) status = 'failed';
    const detail = detailByStage.get(stage.id);
    return { id: stage.id, label: stage.label, status, ...(detail ? { detail } : {}) };
  });
}

/** Map canonical timeline events onto stage ids for their `detail` text. */
function stageDetails(timeline: readonly AgentModeRunHistoryEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const event of timeline) {
    if (!event.reason) continue;
    const stageId = stageForNextState(event.nextState);
    if (stageId && !out.has(stageId)) out.set(stageId, event.reason);
  }
  return out;
}

/**
 * Consent detail for the governed approval modal.
 *
 * Built from the SANITIZED card, so the operator sees the task, the policy and
 * execution facts, and every warning — and never the fingerprint, snapshot id,
 * workspace material fingerprint, or an environment value.
 *
 * Pure (no vscode) so the sanitation is unit-testable.
 */
export function approvalConsentDetail(task: string, policy: readonly Row[], changeNote: string, warnings: readonly string[]): string {
  const lines = [task, '', changeNote, ''];
  for (const row of policy) {
    lines.push(`${row.label}: ${row.value}`);
  }
  if (warnings.length) {
    lines.push('', ...warnings.map((warning) => `Warning: ${warning}`));
  }
  lines.push('', 'This approves ONE execution of the server-owned recipe. It cannot be reused.');
  return lines.join('\n');
}

function stageForNextState(state: AgentModeState): string | undefined {
  switch (state) {
    case 'PLANNING':
      return 'queued';
    case 'AWAITING_APPROVAL':
      return 'planning';
    case 'APPROVED':
      return 'approval';
    case 'EXECUTING':
      return 'executing';
    case 'COMPLETED':
      return 'validating';
    default:
      return undefined;
  }
}
