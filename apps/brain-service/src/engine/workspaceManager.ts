/**
 * MigraAI Engine — Workspace Manager.
 *
 * The object every client uses. A workspace OWNS its source, index, memory,
 * agents, model preferences, permissions, and health — so a client just says
 * "Open Workspace" / "Sync Workspace" and the engine knows the rest. This is the
 * orchestration layer over the index service, conversation memory, agent
 * registry, and model registry.
 *
 * Scope-isolated (owner + workspace) and durable: workspace records survive
 * restart. A workspace maps 1:1 to a scope, so it is idempotent to open.
 */

import type { IndexService, Scope } from './rag/indexService.js';
import type { ConversationStore } from './memory/conversationStore.js';
import type { AgentRegistry } from './agentRegistry.js';
import type { WorkspacePersistence, PersistedWorkspace } from './persistence/types.js';
import type { EngineVersion } from './version.js';

export interface WorkspaceRecord {
  id: string;
  ownerScope: string;
  workspaceScope: string;
  name: string;
  root: string;
  gitRepo?: string;
  gitBranch?: string;
  memoryMode: 'off' | 'session' | 'durable';
  indexId?: string;
  providerPreferences?: Record<string, string>;
  permissions?: string[];
  lastSyncAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceView {
  workspace: Omit<WorkspaceRecord, 'ownerScope' | 'workspaceScope'>;
  health: 'ready' | 'needs-approval' | 'needs-sync' | 'indexing' | 'degraded';
  index: { id?: string; version: number; state?: string; files: number; chunks: number; embeddingModel?: string; lastSyncAt?: number; pendingSync: boolean };
  memory: { mode: string; activeConversations: number };
  agents: string[];
  models: { coding: string[]; reasoning: string[]; general: string[]; vision: string[]; embedding: string[] };
  versions: EngineVersion;
}

export interface WorkspaceManagerDeps {
  indexService: IndexService;
  conversations: ConversationStore;
  agents: AgentRegistry;
  /** Approved model ids grouped by tier (from the model registry + qualification). */
  approvedModelsByTier: () => Promise<WorkspaceView['models']>;
  version: (schemaVersion: number) => EngineVersion;
  schemaVersion: () => number;
  persistence?: WorkspacePersistence;
  /** Injected so tests avoid touching the real git tree. */
  gitInfo?: (root: string) => Promise<{ repo?: string; branch?: string }>;
  now?: () => number;
  mkId?: () => string;
}

export class WorkspaceManager {
  private readonly byId = new Map<string, WorkspaceRecord>();
  private readonly now: () => number;
  private readonly mkId: () => string;

  constructor(private readonly deps: WorkspaceManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.mkId = deps.mkId ?? (() => `ws_${Math.random().toString(36).slice(2, 12)}`);
  }

  hydrate(): void {
    if (!this.deps.persistence) return;
    for (const w of this.deps.persistence.loadWorkspaces()) this.byId.set(w.id, fromPersisted(w));
  }

  private forScope(scope: Scope, id?: string): WorkspaceRecord | undefined {
    for (const w of this.byId.values()) {
      if (w.ownerScope !== scope.owner || w.workspaceScope !== scope.workspace) continue;
      if (id && w.id !== id) continue;
      return w;
    }
    return undefined;
  }

  /** Open (register or reuse) the workspace for a scope. Idempotent per scope. */
  async openWorkspace(scope: Scope, params: { name?: string; root: string; memoryMode?: 'off' | 'session' | 'durable' }): Promise<WorkspaceRecord> {
    const existing = this.forScope(scope);
    const git = (await this.deps.gitInfo?.(params.root)) ?? {};
    if (existing) {
      existing.name = params.name ?? existing.name;
      existing.root = params.root;
      existing.gitRepo = git.repo ?? existing.gitRepo;
      existing.gitBranch = git.branch ?? existing.gitBranch;
      if (params.memoryMode) existing.memoryMode = params.memoryMode;
      existing.updatedAt = this.now();
      this.persist(existing);
      return existing;
    }
    // New workspace: create its index so retrieval/sync have a home.
    const index = this.deps.indexService.createIndex(scope, { sourceType: 'workspace', root: params.root });
    const record: WorkspaceRecord = {
      id: this.mkId(), ownerScope: scope.owner, workspaceScope: scope.workspace,
      name: params.name ?? basename(params.root), root: params.root, gitRepo: git.repo, gitBranch: git.branch,
      memoryMode: params.memoryMode ?? 'session', indexId: index.id, createdAt: this.now(), updatedAt: this.now(),
    };
    this.byId.set(record.id, record);
    this.persist(record);
    return record;
  }

  list(scope: Scope): WorkspaceRecord[] {
    return [...this.byId.values()].filter((w) => w.ownerScope === scope.owner && w.workspaceScope === scope.workspace);
  }

  get(id: string, scope: Scope): WorkspaceRecord | undefined {
    return this.forScope(scope, id);
  }

  patch(id: string, scope: Scope, changes: { name?: string; memoryMode?: 'off' | 'session' | 'durable'; providerPreferences?: Record<string, string> }): WorkspaceRecord | undefined {
    const w = this.forScope(scope, id);
    if (!w) return undefined;
    if (changes.name) w.name = changes.name;
    if (changes.memoryMode) w.memoryMode = changes.memoryMode;
    if (changes.providerPreferences) w.providerPreferences = changes.providerPreferences;
    w.updatedAt = this.now();
    this.persist(w);
    return w;
  }

  async delete(id: string, scope: Scope): Promise<boolean> {
    const w = this.forScope(scope, id);
    if (!w) return false;
    if (w.indexId) this.deps.indexService.delete(w.indexId, scope);
    this.byId.delete(id);
    this.deps.persistence?.deleteWorkspace(id);
    return true;
  }

  /** Sync the workspace's index (creating one if missing). */
  async sync(id: string, scope: Scope): Promise<{ ok: true; view: WorkspaceView } | { ok: false; code: string; error: string }> {
    const w = this.forScope(scope, id);
    if (!w) return { ok: false, code: 'UNKNOWN_WORKSPACE', error: 'Workspace not found.' };
    if (!w.indexId) {
      const idx = this.deps.indexService.createIndex(scope, { sourceType: 'workspace', root: w.root });
      w.indexId = idx.id;
    }
    const res = await this.deps.indexService.sync(w.indexId, scope);
    if (!res.ok) return { ok: false, code: res.code, error: res.error };
    // A sync moves the index to a new version. If it was already approved, that
    // approval covered the OLD content — demote so the new version must be
    // re-approved before it backs production RAG. (Sync never auto-approves.)
    if (res.record.state === 'approved') this.deps.indexService.setState(w.indexId, scope, 'evaluated');
    w.lastSyncAt = this.now();
    w.updatedAt = this.now();
    this.persist(w);
    return { ok: true, view: await this.view(id, scope) as WorkspaceView };
  }

  /** Rebuild from scratch: drop the index and re-create + sync. The new index is
   * `experimental` — it must be re-approved before it backs production chat. */
  async rebuild(id: string, scope: Scope): Promise<{ ok: true; view: WorkspaceView } | { ok: false; code: string; error: string }> {
    const w = this.forScope(scope, id);
    if (!w) return { ok: false, code: 'UNKNOWN_WORKSPACE', error: 'Workspace not found.' };
    if (w.indexId) this.deps.indexService.delete(w.indexId, scope);
    const idx = this.deps.indexService.createIndex(scope, { sourceType: 'workspace', root: w.root });
    w.indexId = idx.id;
    this.persist(w);
    return this.sync(id, scope);
  }

  /**
   * Approve the workspace's current index for production RAG.
   *
   * Approval binds to the EXACT index version the caller observed. If a sync or
   * rebuild changed the index since (a higher/different `version`), we refuse
   * with STALE_VERSION so a stale approval can never promote content the caller
   * never actually reviewed. An empty index (no chunks) cannot be approved.
   */
  async approveIndex(id: string, scope: Scope, expectedVersion: number): Promise<{ ok: true; view: WorkspaceView } | { ok: false; code: string; error: string }> {
    const w = this.forScope(scope, id);
    if (!w) return { ok: false, code: 'UNKNOWN_WORKSPACE', error: 'Workspace not found.' };
    if (!w.indexId) return { ok: false, code: 'NO_INDEX', error: 'Workspace has no index to approve.' };
    const status = this.deps.indexService.status(w.indexId, scope);
    if (!status) return { ok: false, code: 'NO_INDEX', error: 'Workspace has no index to approve.' };
    if (status.syncing) return { ok: false, code: 'INDEXING', error: 'Index is syncing; wait for it to finish before approving.' };
    if (status.stats.chunks === 0) return { ok: false, code: 'NOT_INDEXED', error: 'Nothing indexed yet; sync before approving.' };
    if (status.version !== expectedVersion) {
      return { ok: false, code: 'STALE_VERSION', error: `Index changed (now version ${status.version}, you approved version ${expectedVersion}). Review and approve again.` };
    }
    this.deps.indexService.setState(w.indexId, scope, 'approved');
    w.updatedAt = this.now();
    this.persist(w);
    return { ok: true, view: (await this.view(id, scope)) as WorkspaceView };
  }

  /** The aggregated "MigraAI Workspace" view. */
  async view(id: string, scope: Scope): Promise<WorkspaceView | undefined> {
    const w = this.forScope(scope, id);
    if (!w) return undefined;
    const status = w.indexId ? this.deps.indexService.status(w.indexId, scope) : undefined;
    // pendingSync = content not yet indexed (never synced). Approval is a SEPARATE
    // axis, surfaced via `health`.
    const pendingSync = !status || status.stats.chunks === 0;
    const health: WorkspaceView['health'] = status?.syncing
      ? 'indexing'
      : status?.state === 'degraded'
        ? 'degraded'
        : status?.state === 'approved'
          ? 'ready'
          : (status?.stats.chunks ?? 0) > 0
            ? 'needs-approval'
            : 'needs-sync';
    return {
      workspace: { id: w.id, name: w.name, root: w.root, gitRepo: w.gitRepo, gitBranch: w.gitBranch, memoryMode: w.memoryMode, indexId: w.indexId, providerPreferences: w.providerPreferences, permissions: w.permissions, lastSyncAt: w.lastSyncAt, createdAt: w.createdAt, updatedAt: w.updatedAt },
      health,
      index: { id: w.indexId, version: status?.version ?? 0, state: status?.state, files: status?.stats.files ?? 0, chunks: status?.stats.chunks ?? 0, embeddingModel: status?.embeddingModel, lastSyncAt: w.lastSyncAt, pendingSync },
      memory: { mode: w.memoryMode, activeConversations: this.deps.conversations.listConversations(scope).length },
      agents: this.deps.agents.list().map((a) => a.id),
      models: await this.deps.approvedModelsByTier(),
      versions: this.deps.version(this.deps.schemaVersion()),
    };
  }

  private persist(w: WorkspaceRecord): void {
    this.deps.persistence?.saveWorkspace(toPersisted(w));
  }
}

function basename(p: string): string {
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p;
}
function toPersisted(w: WorkspaceRecord): PersistedWorkspace {
  return {
    id: w.id, ownerScope: w.ownerScope, workspaceScope: w.workspaceScope, name: w.name, root: w.root,
    gitRepo: w.gitRepo, gitBranch: w.gitBranch, memoryMode: w.memoryMode, indexId: w.indexId,
    providerPreferences: w.providerPreferences ? JSON.stringify(w.providerPreferences) : undefined,
    permissions: w.permissions ? JSON.stringify(w.permissions) : undefined,
    lastSyncAt: w.lastSyncAt, createdAt: w.createdAt, updatedAt: w.updatedAt,
  };
}
function fromPersisted(w: PersistedWorkspace): WorkspaceRecord {
  return {
    id: w.id, ownerScope: w.ownerScope, workspaceScope: w.workspaceScope, name: w.name, root: w.root,
    gitRepo: w.gitRepo, gitBranch: w.gitBranch, memoryMode: (w.memoryMode as WorkspaceRecord['memoryMode']) ?? 'session', indexId: w.indexId,
    providerPreferences: w.providerPreferences ? JSON.parse(w.providerPreferences) : undefined,
    permissions: w.permissions ? JSON.parse(w.permissions) : undefined,
    lastSyncAt: w.lastSyncAt, createdAt: w.createdAt, updatedAt: w.updatedAt,
  };
}
