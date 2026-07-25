// MigraPilot Shell — right-hand context panels (§10).
//
// WorkspaceContextPanel · BrainHealthPanel · AgentContextPanel ·
// ActiveRunSummary · ContextFilesPanel · RecentActivityPanel
//
// Every panel is built from canonical data and resolves its own {@link DataState}
// so a Brain outage degrades one card instead of blanking the shell (§14).
//
// Two invariants are enforced here:
//   - the Agent context shows activation STATUS only, never the activation
//     capability, the bootstrap secret, or an approval fingerprint;
//   - nothing is fabricated: a value the extension could not read renders as an
//     em dash with a `muted` tone.

import type { AgentModeCommandRunView } from '@migrapilot/protocol';
import { approvalBadge, integrityBadge, recoveryBadge, runStateBadge } from './runStateModel.js';
import { type Badge, type Panel, type Row, formatDuration, optionalRow, relativeAge, shortenId } from './types.js';

// ── Workspace context ─────────────────────────────────────────────────────────

/** Read-only Git facts, produced by `services/gitContext.ts` from allow-listed
 * read commands. `undefined` fields mean "could not be determined". */
export interface GitContextSnapshot {
  /** Repository folder name (never the absolute path). */
  repository?: string;
  branch?: string;
  /** true = clean tree, false = dirty, undefined = unknown. */
  clean?: boolean;
  changedFileCount?: number;
  ahead?: number;
  behind?: number;
  upstream?: string;
  latestCommitShort?: string;
  latestCommitSubject?: string;
  /** Set when git could not be inspected at all. */
  unavailableReason?: string;
}

export function toWorkspaceContextPanel(snapshot: GitContextSnapshot | undefined): Panel {
  if (!snapshot) {
    return {
      title: 'Workspace Context',
      state: 'loading',
      rows: [],
      placeholder: { state: 'loading', message: 'Reading workspace state…' },
    };
  }
  if (snapshot.unavailableReason) {
    return {
      title: 'Workspace Context',
      state: 'disconnected',
      rows: [],
      placeholder: {
        state: 'disconnected',
        message: snapshot.unavailableReason,
        retryCommand: 'refreshContext',
        retryLabel: 'Retry',
      },
    };
  }
  const treeState: Row =
    snapshot.clean === undefined
      ? { label: 'Status', value: '—', tone: 'muted' }
      : snapshot.clean
        ? { label: 'Status', value: 'Clean', tone: 'ok' }
        : { label: 'Status', value: `${snapshot.changedFileCount ?? 0} changed`, tone: 'warn' };

  const aheadBehind: Row =
    snapshot.ahead === undefined || snapshot.behind === undefined
      ? { label: 'Ahead / Behind', value: '—', tone: 'muted' }
      : {
          label: 'Ahead / Behind',
          value: `${snapshot.ahead} / ${snapshot.behind}`,
          tone: snapshot.ahead === 0 && snapshot.behind === 0 ? 'muted' : 'info',
        };

  return {
    title: 'Workspace Context',
    state: 'ready',
    rows: [
      optionalRow('Repository', snapshot.repository),
      optionalRow('Branch', snapshot.branch, 'info', true),
      treeState,
      aheadBehind,
      optionalRow('Upstream', snapshot.upstream, undefined, true),
      optionalRow(
        'Latest commit',
        snapshot.latestCommitShort ? `${snapshot.latestCommitShort} ${snapshot.latestCommitSubject ?? ''}`.trim() : undefined,
        undefined,
        true,
      ),
    ],
  };
}

// ── Brain service status ──────────────────────────────────────────────────────

/** Shape actually returned by the brain's `GET /health`. `HealthResponse` in
 * shared-types covers the base fields; the engine additionally returns
 * `readiness`, `engine` and `operational`, so they are typed optionally here and
 * read defensively. */
export interface BrainHealthSnapshot {
  status?: string;
  version?: string;
  uptimeSec?: number;
  readiness?: {
    process?: string;
    inferenceProviders?: string;
    persistence?: string;
    memory?: string;
    rag?: string;
    schemaVersion?: number;
    migrationState?: string;
  };
  operational?: {
    status?: string;
    reachable?: boolean;
    schemaCurrent?: boolean;
    schemaVersion?: number;
    integrity?: string;
    retentionWorker?: string;
    writeLatencyMs?: number | null;
    storageBytes?: number | null;
  };
}

export interface BrainHealthPanelModel extends Panel {
  /** Header badge for the shell header + status row. */
  badge: Badge;
  endpoint: string;
}

export function toBrainHealthPanel(
  endpoint: string,
  snapshot: BrainHealthSnapshot | undefined,
  error?: string,
): BrainHealthPanelModel {
  if (error || !snapshot) {
    return {
      title: 'Brain Service Status',
      state: error ? 'disconnected' : 'loading',
      endpoint,
      badge: error
        ? { text: 'Disconnected', tone: 'error', title: error }
        : { text: 'Checking…', tone: 'muted', title: 'Reading the Brain service health endpoint.' },
      rows: [{ label: 'Endpoint', value: endpoint, tone: 'muted', mono: true }],
      placeholder: {
        state: error ? 'disconnected' : 'loading',
        message: error ?? 'Contacting the Brain service…',
        retryCommand: 'repairConnection',
        retryLabel: 'Repair Connection',
      },
    };
  }

  const status = snapshot.status ?? 'unknown';
  const badge: Badge =
    status === 'ok'
      ? { text: 'Healthy', tone: 'ok', title: 'The Brain service reported ok.' }
      : status === 'degraded'
        ? { text: 'Degraded', tone: 'warn', title: 'The Brain service reported degraded readiness.' }
        : { text: status, tone: 'error', title: `The Brain service reported ${status}.` };

  const schemaVersion = snapshot.operational?.schemaVersion ?? snapshot.readiness?.schemaVersion;
  const integrity = snapshot.operational?.integrity;
  const retention = snapshot.operational?.retentionWorker;
  const persistence = snapshot.readiness?.persistence;

  return {
    title: 'Brain Service Status',
    state: status === 'ok' ? 'ready' : 'degraded',
    endpoint,
    badge,
    rows: [
      { label: 'Endpoint', value: endpoint, tone: 'muted', mono: true },
      optionalRow('Version', snapshot.version, undefined, true),
      optionalRow('Uptime', snapshot.uptimeSec === undefined ? undefined : formatDuration(snapshot.uptimeSec)),
      optionalRow(
        'Schema version',
        schemaVersion === undefined ? undefined : String(schemaVersion),
        snapshot.operational?.schemaCurrent === true ? 'ok' : snapshot.operational?.schemaCurrent === false ? 'warn' : undefined,
        true,
      ),
      // Canonical value verbatim — 'ok' or the first reported integrity problem.
      optionalRow('Integrity', integrity, integrity === 'ok' ? 'ok' : integrity ? 'error' : undefined),
      optionalRow('Retention worker', retention, retention === 'running' ? 'ok' : retention ? 'warn' : undefined),
      optionalRow('Persistence', persistence, persistence === 'ready' ? 'ok' : persistence ? 'warn' : undefined),
      optionalRow(
        'Inference providers',
        snapshot.readiness?.inferenceProviders,
        snapshot.readiness?.inferenceProviders === 'available' ? 'ok' : snapshot.readiness?.inferenceProviders ? 'warn' : undefined,
      ),
    ],
  };
}

// ── Agent context ─────────────────────────────────────────────────────────────

/** Sanitized activation status. The activation CAPABILITY is deliberately absent
 * from this type so it cannot be posted to a webview even by mistake. */
export interface AgentActivationStatus {
  valid: boolean;
  /** Workspace folder name only — never the absolute canonical path. */
  workspaceLabel?: string;
  allowedRecipes?: readonly string[];
  expiresAt?: number;
}

export interface AgentContextInput {
  /** Whether the operator explicitly entered Agent Mode this session. */
  modeEntered: boolean;
  activation: AgentActivationStatus | undefined;
  /** Execution policy preference (server-authoritative resolution). */
  policy?: string;
  /** Active run, for the live approval TTL + risk ceiling. */
  run?: AgentModeCommandRunView;
  now: number;
}

export function toAgentContextPanel(input: AgentContextInput): Panel {
  const { activation, run, now } = input;
  if (!activation || !activation.valid) {
    return {
      title: 'Agent Context',
      state: 'activation-required',
      rows: [
        { label: 'Mode', value: input.modeEntered ? 'Governed' : 'Off', tone: input.modeEntered ? 'governed' : 'muted' },
        { label: 'Activation', value: 'Required', tone: 'warn' },
      ],
      placeholder: {
        state: 'activation-required',
        message: 'Agent Mode is not activated for this workspace. Pair it explicitly before proposing a command.',
        retryCommand: 'pairAgentMode',
        retryLabel: 'Pair Agent Mode',
      },
    };
  }

  const ttlSource = run?.approval?.expiresAt ?? run?.preview?.expiresAt ?? activation.expiresAt;
  const ttlSeconds = ttlSource === undefined ? undefined : Math.max(0, Math.round((ttlSource - now) / 1000));
  const riskCeiling = run?.preview?.mutationClassification;

  return {
    title: 'Agent Context',
    state: 'ready',
    rows: [
      { label: 'Mode', value: input.modeEntered ? 'Governed' : 'Governed (idle)', tone: 'governed' },
      // STATUS ONLY. The capability itself is never surfaced.
      { label: 'Activation', value: 'Valid', tone: 'ok' },
      optionalRow('Workspace', activation.workspaceLabel, undefined, true),
      optionalRow('Policy', input.policy, 'info'),
      optionalRow(
        'Approval TTL',
        ttlSeconds === undefined ? undefined : ttlSeconds > 0 ? formatDuration(ttlSeconds) : 'closed',
        ttlSeconds !== undefined && ttlSeconds === 0 ? 'warn' : undefined,
      ),
      optionalRow('Risk ceiling', riskCeiling, riskCeiling === 'read-only' ? 'ok' : riskCeiling ? 'governed' : undefined),
      optionalRow(
        'Allowed recipes',
        activation.allowedRecipes?.length ? activation.allowedRecipes.join(', ') : undefined,
        undefined,
        true,
      ),
    ],
  };
}

// ── Active run summary ────────────────────────────────────────────────────────

export interface ActiveRunSummary {
  state: 'ready' | 'empty';
  runIdShort: string;
  runId: string;
  rows: Row[];
  badges: Badge[];
  /** Evidence-only affordance. */
  openDetail: boolean;
}

export function toActiveRunSummary(run: AgentModeCommandRunView | undefined): ActiveRunSummary {
  if (!run) {
    return { state: 'empty', runIdShort: '—', runId: '', rows: [], badges: [], openDetail: false };
  }
  return {
    state: 'ready',
    runIdShort: shortenId(run.runId),
    runId: run.runId,
    badges: [
      runStateBadge(run.state),
      approvalBadge(run.approval?.lifecycle),
      recoveryBadge(run.recovery?.classification),
    ],
    rows: [
      { label: 'Run', value: shortenId(run.runId), tone: 'muted', mono: true },
      { label: 'State', value: run.state, tone: runStateBadge(run.state).tone },
      { label: 'Approval', value: approvalBadge(run.approval?.lifecycle).text, tone: approvalBadge(run.approval?.lifecycle).tone },
      {
        label: 'Recovery',
        value: recoveryBadge(run.recovery?.classification).text,
        tone: recoveryBadge(run.recovery?.classification).tone,
      },
      optionalRow('Integrity', undefined),
    ],
    openDetail: true,
  };
}

/** Integrity lives on history summaries, not on the live run view, so the live
 * summary is completed from history when the record exists. */
export function withHistoryIntegrity(summary: ActiveRunSummary, integrity: string | undefined, issues: readonly string[] = []): ActiveRunSummary {
  if (summary.state !== 'ready') return summary;
  const badge = integrityBadge(integrity, issues);
  const rows = summary.rows.map((row) => (row.label === 'Integrity' ? { ...row, value: badge.text, tone: badge.tone } : row));
  return { ...summary, rows, badges: [...summary.badges, badge] };
}

// ── Context files ─────────────────────────────────────────────────────────────

export interface ContextFileEntry {
  /** Workspace-relative path — never absolute. */
  path: string;
  /** Why the file is in context, when the source reported one. */
  reason?: string;
  kind: 'active-editor' | 'attachment' | 'referenced';
}

export function toContextFilesPanel(entries: readonly ContextFileEntry[]): Panel {
  if (!entries.length) {
    return {
      title: 'Context Files',
      state: 'empty',
      rows: [],
      placeholder: { state: 'empty', message: 'No files are attached to this conversation yet.' },
      actions: [{ id: 'addContext', label: 'Add files to context', kind: 'secondary', icon: 'add' }],
    };
  }
  return {
    title: 'Context Files',
    state: 'ready',
    rows: entries.map((entry) => ({
      label: entry.path,
      value: entry.reason ?? KIND_LABEL[entry.kind],
      tone: entry.kind === 'active-editor' ? 'info' : 'muted',
      mono: true,
    })),
    actions: [{ id: 'addContext', label: 'Add files to context', kind: 'secondary', icon: 'add' }],
  };
}

const KIND_LABEL: Record<ContextFileEntry['kind'], string> = {
  'active-editor': 'active editor',
  attachment: 'attached',
  referenced: 'referenced',
};

// ── Recent activity ───────────────────────────────────────────────────────────

/** An activity entry the EXTENSION itself observed (a lifecycle result, a run
 * transition, an evidence export). Nothing here is invented: the recorder only
 * appends after the corresponding canonical operation actually happened. */
export interface ActivityEntry {
  at: number;
  text: string;
  tone: 'ok' | 'info' | 'warn' | 'error';
}

export function toRecentActivityPanel(entries: readonly ActivityEntry[], now: number): Panel {
  if (!entries.length) {
    return {
      title: 'Recent Activity',
      state: 'empty',
      rows: [],
      placeholder: { state: 'empty', message: 'No MigraPilot activity recorded in this session yet.' },
    };
  }
  return {
    title: 'Recent Activity',
    state: 'ready',
    rows: entries.map((entry) => ({ label: entry.text, value: relativeAge(entry.at, now), tone: entry.tone })),
  };
}

/**
 * Bounded, in-memory activity recorder. Session-scoped by design — it is a view
 * of what this extension session observed, NOT a second audit log, so it never
 * competes with the durable evidence store.
 */
export class ActivityRecorder {
  private readonly entries: ActivityEntry[] = [];

  constructor(private readonly limit = 20) {}

  record(text: string, tone: ActivityEntry['tone'], at: number): void {
    this.entries.unshift({ at, text: text.slice(0, 160), tone });
    if (this.entries.length > this.limit) this.entries.length = this.limit;
  }

  list(): readonly ActivityEntry[] {
    return this.entries;
  }
}
