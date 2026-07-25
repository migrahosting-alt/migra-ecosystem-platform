// MigraPilot Shell — canonical run-state → display mapping.
//
// SECURITY-RELEVANT. Three rules are enforced here and nowhere else:
//
//  1. Backend terminology is displayed VERBATIM for security-relevant fields
//     (state, approval lifecycle, recovery class, integrity). The UI never
//     invents a friendlier synonym for `EXPIRED` or `UNTRUSTED`.
//  2. Control availability is derived ONLY from authoritative server state, and
//     always denies by default. `resume` does not exist as a concept.
//  3. History records are EVIDENCE ONLY: `historyControlAvailability()` is a
//     constant all-false record, so a terminal history row can never grow an
//     approve/resume/execute/cancel control.

import type {
  AgentModeApprovalLifecycle,
  AgentModeCommandRunView,
  AgentModeRecoveryClass,
  AgentModeRunHistoryQuery,
  AgentModeState,
} from '@migrapilot/protocol';
import type { Badge, Tone } from './types.js';

/** Integrity is a 3-value enum on history summaries. */
export type HistoryIntegrity = 'TRUSTED' | 'WARNING' | 'UNTRUSTED';

/** Colour contract from §9. Anything unrecognised falls back to `muted` rather
 * than to a reassuring colour. */
const RUN_STATE_TONE: Record<AgentModeState, Tone> = {
  IDLE: 'muted',
  PLANNING: 'info',
  AWAITING_APPROVAL: 'governed',
  APPROVED: 'governed',
  EXECUTING: 'info',
  COMPLETED: 'ok',
  REJECTED: 'error',
  EXPIRED: 'warn',
  STALE: 'warn',
  FAILED: 'error',
  CANCELLED: 'error',
};

/** Operator-facing elaboration. The BADGE text stays canonical; this is the
 * accessible description, so no security term is ever replaced. */
const RUN_STATE_TITLE: Record<AgentModeState, string> = {
  IDLE: 'No Agent Mode command lifecycle is active.',
  PLANNING: 'The engine is preparing a server-owned proposal.',
  AWAITING_APPROVAL: 'A proposal is waiting for explicit one-time approval.',
  APPROVED: 'Approved once. The engine holds the authority to execute.',
  EXECUTING: 'The engine is executing the approved recipe.',
  COMPLETED: 'The run finished and its evidence is durable.',
  REJECTED: 'The operator rejected this proposal. It can never execute.',
  EXPIRED: 'The approval window closed. A fresh proposal is required.',
  STALE: 'The run no longer matches authoritative state. A fresh proposal is required.',
  FAILED: 'The run failed. Inspect the evidence before proposing again.',
  CANCELLED: 'The run was cancelled before execution completed.',
};

export function runStateBadge(state: AgentModeState): Badge {
  return { text: state, tone: RUN_STATE_TONE[state] ?? 'muted', title: RUN_STATE_TITLE[state] ?? 'Unrecognised run state.' };
}

const INTEGRITY_TONE: Record<HistoryIntegrity, Tone> = {
  TRUSTED: 'ok',
  WARNING: 'warn',
  UNTRUSTED: 'error',
};

export function integrityBadge(integrity: HistoryIntegrity | string | undefined, issues: readonly string[] = []): Badge {
  if (!integrity) return { text: 'UNKNOWN', tone: 'muted', title: 'Integrity has not been reported for this run.' };
  const tone = INTEGRITY_TONE[integrity as HistoryIntegrity] ?? 'muted';
  const title = issues.length
    ? `Integrity ${integrity}: ${issues.join('; ')}`
    : integrity === 'TRUSTED'
      ? 'The durable evidence chain verified for this run.'
      : `Integrity reported as ${integrity}.`;
  return { text: integrity, tone, title };
}

const APPROVAL_TONE: Record<AgentModeApprovalLifecycle, Tone> = {
  NOT_REQUESTED: 'muted',
  PENDING_DISPLAY: 'governed',
  DISPLAYED: 'governed',
  APPROVED: 'ok',
  REJECTED: 'error',
  EXPIRED: 'warn',
  INVALIDATED: 'warn',
  LOST_ON_RESTART: 'warn',
  CONSUMED: 'ok',
};

export function approvalBadge(lifecycle: AgentModeApprovalLifecycle | undefined): Badge {
  if (!lifecycle) return { text: 'NOT_REQUESTED', tone: 'muted', title: 'No approval has been requested for this run.' };
  return { text: lifecycle, tone: APPROVAL_TONE[lifecycle] ?? 'muted', title: `Approval lifecycle: ${lifecycle}` };
}

/** A recovery class is either "a fresh proposal may be possible" (amber) or a
 * hard stop (red/muted). It NEVER implies resume. */
const RECOVERY_TONE: Record<AgentModeRecoveryClass, Tone> = {
  NONE: 'muted',
  REPROPOSAL_ALLOWED: 'warn',
  REPROPOSAL_REQUIRED: 'warn',
  TERMINAL_NO_RECOVERY: 'muted',
  SUCCESSOR_CREATED: 'info',
  WORKSPACE_MISMATCH: 'error',
  POLICY_CHANGED: 'warn',
  SNAPSHOT_CHANGED: 'warn',
  RECIPE_DISABLED: 'error',
  AUTHORIZATION_LOST: 'error',
  INTERRUPTED_EXECUTION: 'warn',
  RETENTION_REMOVED: 'muted',
  SCHEMA_INCOMPATIBLE: 'error',
};

export function recoveryBadge(recoveryClass: AgentModeRecoveryClass | undefined): Badge {
  if (!recoveryClass) return { text: 'NONE', tone: 'muted', title: 'No recovery classification recorded.' };
  return {
    text: recoveryClass,
    tone: RECOVERY_TONE[recoveryClass] ?? 'muted',
    title: `Recovery classification: ${recoveryClass}. Recovery never resumes a run — it can only create a new proposal.`,
  };
}

/** Risk badge for a proposal. Derived from the server's own mutation
 * classification — never from model text. */
export function riskBadge(mutationClassification: string | undefined, canModifyFiles: boolean | undefined): Badge {
  if (!mutationClassification) return { text: 'RISK UNKNOWN', tone: 'muted', title: 'The engine did not report a mutation classification.' };
  if (mutationClassification === 'read-only' && canModifyFiles === false) {
    return { text: 'READ-ONLY', tone: 'ok', title: 'The engine classified this recipe as read-only and it cannot modify files.' };
  }
  return {
    text: mutationClassification.toUpperCase(),
    tone: 'governed',
    title: `The engine classified this recipe as ${mutationClassification}${canModifyFiles ? ' and it can modify workspace files' : ''}.`,
  };
}

// ── Control availability ──────────────────────────────────────────────────────

/** The complete set of Agent-Mode controls the shell can render. `resume` is
 * typed as `false` so no code path can ever turn it on. */
export interface RunControls {
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  reconcile: boolean;
  /** Structurally impossible. Kept explicit so the guarantee is type-checked. */
  resume: false;
  freshProposal: boolean;
  reviewDiff: boolean;
  inspectEvidence: boolean;
  exportEvidence: boolean;
  /** When set, explains why the run cannot proceed as-is. */
  interruptedNote?: string;
}

const NO_CONTROLS: RunControls = {
  approve: false,
  reject: false,
  cancel: false,
  reconcile: false,
  resume: false,
  freshProposal: false,
  reviewDiff: false,
  inspectEvidence: false,
  exportEvidence: false,
};

/**
 * Derive controls for a LIVE run from authoritative server state.
 *
 * `approve`/`reject` require BOTH `AWAITING_APPROVAL` and a server-issued
 * preview: without a preview there is no fingerprint for the host to bind the
 * decision to, so offering the button would produce a guaranteed failure.
 */
export function runControlAvailability(view: AgentModeCommandRunView | undefined): RunControls {
  if (!view) return { ...NO_CONTROLS };
  const state = view.state;
  const hasPreview = Boolean(view.preview);
  const interrupted = state === 'STALE' || state === 'FAILED' || state === 'EXPIRED';
  return {
    approve: state === 'AWAITING_APPROVAL' && hasPreview,
    reject: state === 'AWAITING_APPROVAL' && hasPreview,
    cancel: state === 'PLANNING' || state === 'AWAITING_APPROVAL' || state === 'APPROVED' || state === 'EXECUTING',
    reconcile: true,
    resume: false,
    // Eligibility is the SERVER's call. Absent eligibility means no.
    freshProposal: view.recovery?.eligible === true,
    reviewDiff: hasPreview,
    inspectEvidence: true,
    exportEvidence: true,
    ...(interrupted
      ? { interruptedNote: 'This run cannot continue. Create a new proposal — it must be reviewed and approved again.' }
      : {}),
  };
}

/**
 * Controls for a TERMINAL HISTORY record. Always all-false: history is evidence
 * only (§9, §21). Inspect/export are evidence reads, not execution authority,
 * so they are the only affordances a history row may offer.
 */
export function historyControlAvailability(): RunControls {
  return { ...NO_CONTROLS, inspectEvidence: true, exportEvidence: true };
}

/** Terminal states never regain execution authority. */
export function isTerminalState(state: AgentModeState): boolean {
  return state === 'COMPLETED' || state === 'REJECTED' || state === 'EXPIRED' || state === 'FAILED' || state === 'CANCELLED' || state === 'STALE';
}

export const HISTORY_SORTS: ReadonlyArray<AgentModeRunHistoryQuery['sort']> = [
  'updatedAt.desc',
  'requestedAt.desc',
  'terminalAt.desc',
];
