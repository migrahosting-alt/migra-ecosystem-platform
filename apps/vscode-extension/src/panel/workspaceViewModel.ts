// MigraAI Workspace — panel view-model.
//
// Pure, vscode-free transform from the engine's authoritative WorkspaceView into
// a sanitized display model the webview renders. This is the single place where:
//   - engine health → operator status language (Ready / Needs approval / …);
//   - internal identifiers (workspace id, index id) are kept OUT of visible rows
//     (they travel on the model for action dispatch only, never rendered);
//   - a git remote URL is stripped of any embedded credentials;
//   - action enablement is derived (e.g. Approve only when there is a current
//     index version that needs approval).
//
// The extension NEVER reconstructs workspace state locally — every field here
// comes straight from the engine view; the mapper only relabels + sanitizes.

import type { WorkspaceView, AgentDescriptor } from '../services/migraAiClient.js';

export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'muted';

export interface PanelRow {
  label: string;
  value: string;
  tone?: Tone;
}

export interface PanelSection {
  title: string;
  rows: PanelRow[];
}

export interface PanelActions {
  /** Approve is only offered when there is an indexed, not-yet-approved version. */
  approve: boolean;
  sync: boolean;
  rebuild: boolean;
  delete: boolean;
  changeMemory: boolean;
}

export interface WorkspacePanelModel {
  /** Internal — used to dispatch actions to the engine. NOT rendered. */
  workspaceId: string;
  /** Internal — Approve binds to this EXACT version so a stale approval is impossible. */
  indexVersion: number;
  /** Internal — for the sync/rebuild "files/chunks changed" delta message. */
  indexFiles: number;
  indexChunks: number;
  /** Internal — default for the change-memory picker. */
  memoryMode: 'off' | 'session' | 'durable';
  name: string;
  status: { label: string; tone: Tone };
  sections: PanelSection[];
  actions: PanelActions;
}

/** Engine health → operator-facing status label + tone. */
export function statusFor(health: WorkspaceView['health']): { label: string; tone: Tone } {
  switch (health) {
    case 'ready':
      return { label: 'Ready', tone: 'ok' };
    case 'needs-approval':
      return { label: 'Needs approval', tone: 'warn' };
    case 'indexing':
      return { label: 'Syncing', tone: 'info' };
    case 'degraded':
      return { label: 'Degraded', tone: 'error' };
    case 'needs-sync':
      return { label: 'Not indexed', tone: 'warn' };
    default:
      return { label: 'Unavailable', tone: 'muted' };
  }
}

/** Index promotion state → human label. */
function indexStateLabel(state: string | undefined, chunks: number): { label: string; tone: Tone } {
  switch (state) {
    case 'approved':
      return { label: 'Approved', tone: 'ok' };
    case 'evaluated':
      return { label: 'Evaluated — needs approval', tone: 'warn' };
    case 'experimental':
      return { label: 'Experimental — needs approval', tone: 'warn' };
    case 'degraded':
      return { label: 'Degraded', tone: 'error' };
    case 'disabled':
      return { label: 'Disabled', tone: 'muted' };
    default:
      return { label: chunks > 0 ? 'Indexed — needs approval' : 'Not indexed', tone: chunks > 0 ? 'warn' : 'muted' };
  }
}

/** Strip any embedded credentials (`user:token@`) from a git remote URL so a
 * token pasted into a remote never surfaces in the panel. */
export function sanitizeGitRepo(repo: string | undefined): string | undefined {
  if (!repo) return undefined;
  return repo.replace(/^(https?:\/\/)[^@/]*@/i, '$1');
}

function relativeTime(at: number | undefined, now: number): string {
  if (!at) return 'never';
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const MEMORY_MODE_LABEL: Record<string, string> = {
  off: 'Off — no memory',
  session: 'Session — in-memory only',
  durable: 'Durable — persisted',
};

/**
 * Map the engine's WorkspaceView (+ optional agent descriptors, to label agents
 * read-only vs mutating) into the sanitized panel model.
 */
export function toPanelModel(view: WorkspaceView, opts: { agents?: AgentDescriptor[]; now?: number } = {}): WorkspacePanelModel {
  const now = opts.now ?? Date.now();
  const status = statusFor(view.health);
  const idx = view.index;
  const idxState = indexStateLabel(idx.state, idx.chunks);
  const repo = sanitizeGitRepo(view.workspace.gitRepo);

  // Agents: available count + mutating vs read-only split (from descriptors when
  // present; otherwise just the id list from the engine view).
  const agentRows: PanelRow[] = agentRows_(view.agents, opts.agents);

  const sections: PanelSection[] = [
    {
      title: 'Workspace',
      rows: [
        { label: 'Name', value: view.workspace.name },
        { label: 'Root', value: view.workspace.root, tone: 'muted' },
        { label: 'Git repo', value: repo ?? 'not a git repository', tone: repo ? undefined : 'muted' },
        { label: 'Branch', value: view.workspace.gitBranch ?? '—', tone: view.workspace.gitBranch ? undefined : 'muted' },
        { label: 'Health', value: status.label, tone: status.tone },
        { label: 'Last sync', value: relativeTime(view.workspace.lastSyncAt, now), tone: view.workspace.lastSyncAt ? undefined : 'muted' },
      ],
    },
    {
      title: 'Semantic Index',
      rows: [
        { label: 'State', value: idxState.label, tone: idxState.tone },
        { label: 'Files', value: String(idx.files) },
        { label: 'Chunks', value: String(idx.chunks) },
        { label: 'Embedding model', value: idx.embeddingModel ?? '—', tone: idx.embeddingModel ? undefined : 'muted' },
        { label: 'Pending approval', value: idx.chunks > 0 && idx.state !== 'approved' ? 'yes' : 'no', tone: idx.chunks > 0 && idx.state !== 'approved' ? 'warn' : 'muted' },
        { label: 'Last indexed', value: relativeTime(idx.lastSyncAt, now), tone: idx.lastSyncAt ? undefined : 'muted' },
      ],
    },
    {
      title: 'Memory',
      rows: [
        { label: 'Mode', value: MEMORY_MODE_LABEL[view.memory.mode] ?? view.memory.mode },
        { label: 'Active conversations', value: String(view.memory.activeConversations) },
      ],
    },
    { title: 'Agents', rows: agentRows },
    {
      title: 'Models',
      rows: [
        { label: 'General', value: joinModels(view.models.general) },
        { label: 'Coding', value: joinModels(view.models.coding) },
        { label: 'Reasoning', value: joinModels(view.models.reasoning) },
        { label: 'Vision', value: joinModels(view.models.vision) },
        { label: 'Embedding', value: joinModels(view.models.embedding) },
      ],
    },
    {
      title: 'Engine',
      rows: [
        { label: 'Engine version', value: view.versions.engineVersion },
        { label: 'Protocol', value: `v${view.versions.protocolVersion}` },
        { label: 'Schema', value: `v${view.versions.schemaVersion}` },
      ],
    },
  ];

  const indexed = idx.chunks > 0;
  const needsApproval = indexed && idx.state !== 'approved' && view.health !== 'indexing';

  return {
    workspaceId: view.workspace.id,
    indexVersion: idx.version,
    indexFiles: idx.files,
    indexChunks: idx.chunks,
    memoryMode: view.workspace.memoryMode,
    name: view.workspace.name,
    status,
    sections,
    actions: {
      approve: needsApproval,
      sync: view.health !== 'indexing',
      rebuild: view.health !== 'indexing',
      delete: true,
      changeMemory: true,
    },
  };
}

function agentRows_(ids: string[], descriptors?: AgentDescriptor[]): PanelRow[] {
  if (!ids.length) return [{ label: 'Agents', value: 'none', tone: 'muted' }];
  if (!descriptors || descriptors.length === 0) {
    return [{ label: 'Available', value: `${ids.length}`, tone: undefined }, { label: 'Agents', value: ids.join(', '), tone: 'muted' }];
  }
  const byId = new Map(descriptors.map((d) => [d.id, d]));
  const readOnly: string[] = [];
  const mutating: string[] = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (d && d.readOnly === false) mutating.push(id);
    else readOnly.push(id);
  }
  const rows: PanelRow[] = [{ label: 'Available', value: String(ids.length) }];
  if (readOnly.length) rows.push({ label: 'Read-only', value: readOnly.join(', '), tone: 'muted' });
  if (mutating.length) rows.push({ label: 'Mutating', value: mutating.join(', '), tone: 'warn' });
  return rows;
}

function joinModels(models: string[]): string {
  return models.length ? models.join(', ') : 'none approved';
}

// ── Multi-root resolution ─────────────────────────────────────────────────────

export interface RootFolder {
  name: string;
  fsPath: string;
}

export type RootResolution =
  | { kind: 'none' }
  | { kind: 'root'; root: string }
  | { kind: 'choose'; options: RootFolder[] };

/**
 * Resolve the workspace root to open. Rules (from the panel spec):
 *  - no folders open → nothing to open;
 *  - exactly one folder → use it (the repository/workspace root, never a
 *    randomly inferred subfolder);
 *  - multiple folders → require explicit selection.
 */
export function resolveWorkspaceRoot(folders: RootFolder[]): RootResolution {
  if (folders.length === 0) return { kind: 'none' };
  if (folders.length === 1) return { kind: 'root', root: folders[0]!.fsPath };
  return { kind: 'choose', options: folders };
}

// ── Destructive-delete confirmation mapping ───────────────────────────────────

export interface DeleteScope {
  /** One line per thing that WILL be removed. */
  removes: string[];
  /** One line per thing that is explicitly KEPT (so the operator is never
   * surprised by broad destruction). */
  keeps: string[];
  /** The exact confirmation phrase the operator must acknowledge. */
  confirmLabel: string;
}

/**
 * Spell out exactly what a workspace delete removes vs keeps. The engine's
 * DELETE removes the workspace registration and its semantic index; conversation
 * and durable memory are scope-owned and are NOT deleted by this action.
 */
export function deleteScopeFor(name: string): DeleteScope {
  return {
    removes: ['Workspace registration', 'Semantic index (files, chunks, embeddings)'],
    keeps: ['Conversation memory (scope-owned)', 'Durable memory (scope-owned)'],
    confirmLabel: `Delete workspace "${name}"`,
  };
}
