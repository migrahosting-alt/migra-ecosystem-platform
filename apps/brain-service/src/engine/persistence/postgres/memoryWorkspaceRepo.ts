/**
 * MigraAI Engine — PostgreSQL memory-item and workspace persistence (Group 2).
 *
 * Preserves SQLite semantics, with two governed differences documented at the
 * point they are enforced:
 *
 *   UNSCOPED ITEMS ARE REFUSED. `MemoryItem.scope` types owner/workspace as
 *   optional and SQLite stores NULLs. Under RLS a NULL-scoped row is either
 *   invisible to everyone or visible to everyone; both are wrong, so the
 *   adapter refuses rather than writing an ambiguous row.
 *
 *   UPSERTS NEVER RE-HOME. SQLite's `INSERT OR REPLACE` on memory_items would
 *   silently move a record to a different owner. Here scope columns are omitted
 *   from the conflict update, so an upsert under a different scope changes
 *   nothing — and RLS refuses it outright, since the existing row is invisible
 *   to the calling tenant and WITH CHECK rejects the new labelling.
 */

import type { PoolClient } from 'pg';
import type { MemoryItem } from '../../memory/conversationStore.js';
import type { PersistedWorkspace } from '../types.js';
import type { ScopedRequest } from './conversationRepo.js';

export class UnscopedRecordError extends Error {
  readonly code = 'UNSCOPED_RECORD';
  constructor(kind: string, id: string) {
    super(
      `${kind} '${id}' has no owner/workspace scope. Refusing to persist: an unscoped row ` +
        'cannot be isolated by row level security.',
    );
    this.name = 'UnscopedRecordError';
  }
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

// ── memory items ────────────────────────────────────────────────────────────

export async function saveMemoryItem(client: PoolClient, item: MemoryItem): Promise<void> {
  const owner = item.scope.owner?.trim();
  const workspace = item.scope.workspace?.trim();
  if (!owner || !workspace) throw new UnscopedRecordError('memory item', item.id);

  await client.query(
    `INSERT INTO memory_items
       (id, owner_scope, workspace_scope, category, content, confidence,
        source_type, source_id, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       category    = EXCLUDED.category,
       content     = EXCLUDED.content,
       confidence  = EXCLUDED.confidence,
       source_type = EXCLUDED.source_type,
       source_id   = EXCLUDED.source_id,
       expires_at  = EXCLUDED.expires_at,
       created_at  = EXCLUDED.created_at`,
    [
      item.id, owner, workspace, item.category, item.content, item.confidence,
      item.sourceType, item.sourceId ?? null, item.expiresAt ?? null, item.createdAt,
    ],
  );
}

/** SQLite imposes no order here, so none is imposed. Callers must not depend on it. */
export async function loadMemoryItems(client: PoolClient): Promise<MemoryItem[]> {
  const { rows } = await client.query<Record<string, unknown>>('SELECT * FROM memory_items');
  return rows.map((r) => ({
    id: String(r.id),
    scope: { owner: String(r.owner_scope), workspace: String(r.workspace_scope) },
    category: String(r.category) as MemoryItem['category'],
    content: String(r.content ?? ''),
    confidence: Number(r.confidence ?? 0),
    sourceType: String(r.source_type ?? ''),
    ...(optStr(r.source_id) ? { sourceId: String(r.source_id) } : {}),
    ...(optNum(r.expires_at) !== undefined ? { expiresAt: num(r.expires_at) } : {}),
    createdAt: num(r.created_at),
  }));
}

// ── workspaces ──────────────────────────────────────────────────────────────

/**
 * Mirrors SQLite's upsert exactly, including which columns it does NOT touch:
 * `owner_scope` and `workspace_scope` are absent from the update, so a
 * workspace cannot be re-homed by re-saving it.
 */
export async function saveWorkspace(client: PoolClient, w: PersistedWorkspace): Promise<void> {
  if (!w.ownerScope?.trim() || !w.workspaceScope?.trim()) {
    throw new UnscopedRecordError('workspace', w.id);
  }
  await client.query(
    `INSERT INTO workspaces
       (id, owner_scope, workspace_scope, name, root, git_repo, git_branch, memory_mode,
        index_id, provider_preferences, permissions, last_sync_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       name                 = EXCLUDED.name,
       root                 = EXCLUDED.root,
       git_repo             = EXCLUDED.git_repo,
       git_branch           = EXCLUDED.git_branch,
       memory_mode          = EXCLUDED.memory_mode,
       index_id             = EXCLUDED.index_id,
       provider_preferences = EXCLUDED.provider_preferences,
       permissions          = EXCLUDED.permissions,
       last_sync_at         = EXCLUDED.last_sync_at,
       updated_at           = EXCLUDED.updated_at`,
    [
      w.id, w.ownerScope, w.workspaceScope, w.name, w.root, w.gitRepo ?? null, w.gitBranch ?? null,
      w.memoryMode, w.indexId ?? null, w.providerPreferences ?? null, w.permissions ?? null,
      w.lastSyncAt ?? null, w.createdAt, w.updatedAt,
    ],
  );
}

export async function deleteWorkspace(client: PoolClient, id: string): Promise<void> {
  await client.query('DELETE FROM workspaces WHERE id = $1', [id]);
}

export async function loadWorkspaces(client: PoolClient): Promise<PersistedWorkspace[]> {
  const { rows } = await client.query<Record<string, unknown>>('SELECT * FROM workspaces');
  return rows.map((r) => ({
    id: String(r.id),
    ownerScope: String(r.owner_scope),
    workspaceScope: String(r.workspace_scope),
    name: String(r.name ?? ''),
    root: String(r.root ?? ''),
    ...(optStr(r.git_repo) ? { gitRepo: String(r.git_repo) } : {}),
    ...(optStr(r.git_branch) ? { gitBranch: String(r.git_branch) } : {}),
    memoryMode: String(r.memory_mode ?? ''),
    ...(optStr(r.index_id) ? { indexId: String(r.index_id) } : {}),
    ...(optStr(r.provider_preferences) ? { providerPreferences: String(r.provider_preferences) } : {}),
    ...(optStr(r.permissions) ? { permissions: String(r.permissions) } : {}),
    ...(optNum(r.last_sync_at) !== undefined ? { lastSyncAt: num(r.last_sync_at) } : {}),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  }));
}

// ── workspace indexes ───────────────────────────────────────────────────────

export interface WorkspaceIndexRow {
  id: string;
  workspaceId: string;
  sourceType?: string;
  root?: string;
  state?: string;
  version?: number;
  createdAt: number;
  updatedAt: number;
}

/** Present so index rows are scope-labelled from creation; full RAG port is Group 3. */
export async function saveWorkspaceIndex(
  client: PoolClient,
  row: WorkspaceIndexRow,
  scope: ScopedRequest,
): Promise<void> {
  await client.query(
    `INSERT INTO workspace_indexes
       (id, workspace_id, owner_scope, workspace_scope, source_type, root, state, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       source_type  = EXCLUDED.source_type,
       root         = EXCLUDED.root,
       state        = EXCLUDED.state,
       version      = EXCLUDED.version,
       updated_at   = EXCLUDED.updated_at`,
    [
      row.id, row.workspaceId, scope.ownerScope, scope.workspaceScope,
      row.sourceType ?? null, row.root ?? null, row.state ?? null, row.version ?? null,
      row.createdAt, row.updatedAt,
    ],
  );
}

export async function loadWorkspaceIndexesFor(client: PoolClient, workspaceId: string): Promise<WorkspaceIndexRow[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    'SELECT * FROM workspace_indexes WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    ...(optStr(r.source_type) ? { sourceType: String(r.source_type) } : {}),
    ...(optStr(r.root) ? { root: String(r.root) } : {}),
    ...(optStr(r.state) ? { state: String(r.state) } : {}),
    ...(optNum(r.version) !== undefined ? { version: num(r.version) } : {}),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  }));
}
