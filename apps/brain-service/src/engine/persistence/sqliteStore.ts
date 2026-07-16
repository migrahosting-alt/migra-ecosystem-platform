/**
 * MigraAI Engine — SQLite durable adapter (node:sqlite).
 *
 * The first real {@link DurableStore}: embedded, transactional, zero-dependency —
 * right for the local single-process engine. Vectors are stored as Float32 BLOBs;
 * a Postgres+pgvector adapter can implement the same interfaces for a hosted
 * deployment.
 *
 * Fail-closed: if the database cannot be opened or the schema version is ahead of
 * this build (incompatible), the store reports `unavailable`/mismatch and the
 * engine must NOT come up "ready" — it never silently serves empty durable state.
 */

import { DatabaseSync } from 'node:sqlite';
import type {
  ConversationPersistence, MemoryItemPersistence, RagIndexPersistence, EmbeddingCachePersistence,
  DurableStore, PersistenceHealth, PersistedChunk, PersistedIndexRecord,
} from './types.js';
import type { Conversation, Message, Summary, MemoryItem } from '../memory/conversationStore.js';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, title TEXT,
  memory_mode TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, status TEXT,
  request_id TEXT, model_id TEXT, provider_id TEXT, created_at INTEGER, durable INTEGER,
  supersedes_id TEXT, seq INTEGER);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON conversation_messages(conversation_id, seq);
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY, conversation_id TEXT, source_from_message_id TEXT,
  source_to_message_id TEXT, summary_json TEXT, version INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, category TEXT,
  content TEXT, confidence REAL, source_type TEXT, source_id TEXT, expires_at INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS workspace_indexes (
  id TEXT PRIMARY KEY, workspace_id TEXT, owner_scope TEXT, source_type TEXT, root TEXT,
  state TEXT, version INTEGER, embedding_model TEXT, embedding_version TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS index_chunks (
  id TEXT PRIMARY KEY, index_id TEXT, workspace_id TEXT, file_path TEXT, language TEXT, symbol TEXT,
  start_line INTEGER, end_line INTEGER, content_hash TEXT, embedding_model TEXT, embedding_version TEXT,
  indexed_at INTEGER, text TEXT, vector BLOB);
CREATE INDEX IF NOT EXISTS idx_chunk_file ON index_chunks(index_id, file_path);
CREATE TABLE IF NOT EXISTS index_versions (index_id TEXT, version INTEGER, committed_at INTEGER, PRIMARY KEY(index_id, version));
CREATE TABLE IF NOT EXISTS embedding_cache (
  model TEXT, version TEXT, content_hash TEXT, dims INTEGER, vector BLOB, created_at INTEGER,
  PRIMARY KEY(model, version, content_hash));
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, name TEXT, root TEXT,
  git_repo TEXT, git_branch TEXT, memory_mode TEXT, index_id TEXT, provider_preferences TEXT,
  permissions TEXT, last_sync_at INTEGER, created_at INTEGER, updated_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_scope ON workspaces(owner_scope, workspace_scope);
`;

function toBlob(vec: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vec).buffer);
}
function fromBlob(buf: Uint8Array): number[] {
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  return Array.from(f);
}

export class SqliteDurableStore implements DurableStore {
  private readonly db: DatabaseSync;
  private schemaVersion = 0;
  private migrationState = 'pending';
  private healthy: 'ready' | 'degraded' | 'unavailable' = 'unavailable';
  private detail?: string;

  constructor(path: string) {
    // Open + migrate up front. A failure here throws — the engine treats that as a
    // fail-closed startup (degraded/unavailable), never a silent empty store.
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(SCHEMA);
    const row = this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version') as { value?: string } | undefined;
    const existing = row?.value ? Number(row.value) : 0;
    if (existing > SCHEMA_VERSION) {
      // Schema is newer than this build — incompatible. Fail closed.
      this.migrationState = 'mismatch';
      this.healthy = 'unavailable';
      this.detail = `db schema v${existing} > engine v${SCHEMA_VERSION}`;
      throw new Error(this.detail);
    }
    // (No intermediate migrations for v1.) Record the current version.
    this.db.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('schema_version', String(SCHEMA_VERSION));
    this.schemaVersion = SCHEMA_VERSION;
    this.migrationState = 'applied';
    this.healthy = 'ready';
  }

  health(): PersistenceHealth {
    return { memoryStore: this.healthy, ragStore: this.healthy, schemaVersion: this.schemaVersion, migrationState: this.migrationState, detail: this.detail };
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }

  // ── ConversationPersistence ──────────────────────────────────────────────
  saveConversation(c: Conversation): void {
    this.db.prepare(
      `INSERT INTO conversations(id,owner_scope,workspace_scope,title,memory_mode,created_at,updated_at,deleted_at)
       VALUES(?,?,?,?,?,?,?,NULL)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at`,
    ).run(c.id, c.ownerScope, c.workspaceScope, c.title, c.memoryMode, c.createdAt, c.updatedAt);
  }

  deleteConversation(id: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(id);
      this.db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(id);
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    });
  }

  saveMessage(m: Message): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO conversation_messages(id,conversation_id,role,content,status,request_id,model_id,provider_id,created_at,durable,supersedes_id,seq)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(m.id, m.conversationId, m.role, m.content, m.status, m.requestId ?? null, m.modelId ?? null, m.providerId ?? null, m.createdAt, m.durable ? 1 : 0, m.supersedesId ?? null, m.createdAt);
  }

  saveSummary(s: Summary): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO conversation_summaries(id,conversation_id,source_from_message_id,source_to_message_id,summary_json,version,created_at)
       VALUES(?,?,?,?,?,?,?)`,
    ).run(s.id, s.conversationId, s.sourceFromMessageId, s.sourceToMessageId, JSON.stringify(s.summary), s.version, s.createdAt);
  }

  loadDurable(): { conversations: Conversation[]; messages: Message[]; summaries: Summary[] } {
    const conversations = (this.db.prepare('SELECT * FROM conversations WHERE deleted_at IS NULL').all() as Array<Record<string, unknown>>).map(rowToConversation);
    const messages = (this.db.prepare('SELECT * FROM conversation_messages ORDER BY conversation_id, seq, rowid').all() as Array<Record<string, unknown>>).map(rowToMessage);
    const summaries = (this.db.prepare('SELECT * FROM conversation_summaries ORDER BY conversation_id, version').all() as Array<Record<string, unknown>>).map(rowToSummary);
    return { conversations, messages, summaries };
  }

  // ── MemoryItemPersistence ────────────────────────────────────────────────
  saveMemoryItem(i: MemoryItem): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO memory_items(id,owner_scope,workspace_scope,category,content,confidence,source_type,source_id,expires_at,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(i.id, i.scope.owner ?? null, i.scope.workspace ?? null, i.category, i.content, i.confidence, i.sourceType, i.sourceId ?? null, i.expiresAt ?? null, i.createdAt);
  }

  loadMemoryItems(): MemoryItem[] {
    return (this.db.prepare('SELECT * FROM memory_items').all() as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, scope: { owner: (r.owner_scope as string) ?? undefined, workspace: (r.workspace_scope as string) ?? undefined },
      category: r.category as MemoryItem['category'], content: r.content as string, confidence: r.confidence as number,
      sourceType: r.source_type as string, sourceId: (r.source_id as string) ?? undefined, expiresAt: (r.expires_at as number) ?? undefined, createdAt: r.created_at as number,
    }));
  }

  // ── RagIndexPersistence ──────────────────────────────────────────────────
  saveIndex(rec: PersistedIndexRecord): void {
    this.db.prepare(
      `INSERT INTO workspace_indexes(id,workspace_id,owner_scope,source_type,root,state,version,embedding_model,embedding_version,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET state=excluded.state, version=excluded.version, updated_at=excluded.updated_at`,
    ).run(rec.id, rec.workspaceId, rec.ownerScope, rec.sourceType, rec.root, rec.state, rec.version, rec.embeddingModel, rec.embeddingVersion, rec.createdAt, rec.updatedAt);
  }

  setIndexState(id: string, state: string, updatedAt: number): void {
    this.db.prepare('UPDATE workspace_indexes SET state=?, updated_at=? WHERE id=?').run(state, updatedAt, id);
  }

  deleteIndex(id: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM index_chunks WHERE index_id=?').run(id);
      this.db.prepare('DELETE FROM index_versions WHERE index_id=?').run(id);
      this.db.prepare('DELETE FROM workspace_indexes WHERE id=?').run(id);
    });
  }

  commitSync(indexId: string, version: number, changed: PersistedChunk[], changedFiles: string[], deletedFiles: string[], updatedAt: number): void {
    // One transaction: rewrite changed files' chunks, drop deleted files, bump
    // version. A throw rolls the whole thing back → the previous version stands.
    this.tx(() => {
      for (const f of [...changedFiles, ...deletedFiles]) {
        this.db.prepare('DELETE FROM index_chunks WHERE index_id=? AND file_path=?').run(indexId, f);
      }
      const ins = this.db.prepare(
        `INSERT INTO index_chunks(id,index_id,workspace_id,file_path,language,symbol,start_line,end_line,content_hash,embedding_model,embedding_version,indexed_at,text,vector)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const c of changed) {
        ins.run(`${indexId}:${c.filePath}#${c.startLine}`, indexId, c.workspaceId, c.filePath, c.language, c.symbol ?? null, c.startLine, c.endLine, c.contentHash, c.embeddingModel, c.embeddingVersion, c.indexedAt, c.text, toBlob(c.vector));
      }
      this.db.prepare('INSERT OR REPLACE INTO index_versions(index_id,version,committed_at) VALUES(?,?,?)').run(indexId, version, updatedAt);
      this.db.prepare('UPDATE workspace_indexes SET version=?, updated_at=? WHERE id=?').run(version, updatedAt, indexId);
    });
  }

  loadIndexes(): PersistedIndexRecord[] {
    return (this.db.prepare('SELECT * FROM workspace_indexes').all() as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, workspaceId: r.workspace_id as string, ownerScope: r.owner_scope as string, sourceType: r.source_type as string,
      root: r.root as string, state: r.state as string, version: r.version as number, embeddingModel: r.embedding_model as string,
      embeddingVersion: r.embedding_version as string, createdAt: r.created_at as number, updatedAt: r.updated_at as number,
    }));
  }

  loadChunks(indexId: string): PersistedChunk[] {
    return (this.db.prepare('SELECT * FROM index_chunks WHERE index_id=?').all(indexId) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, indexId: r.index_id as string, workspaceId: r.workspace_id as string, filePath: r.file_path as string,
      language: r.language as string, symbol: (r.symbol as string) ?? undefined, startLine: r.start_line as number, endLine: r.end_line as number,
      contentHash: r.content_hash as string, embeddingModel: r.embedding_model as string, embeddingVersion: r.embedding_version as string,
      indexedAt: r.indexed_at as number, text: r.text as string, vector: fromBlob(r.vector as Uint8Array),
    }));
  }

  // ── EmbeddingCachePersistence ────────────────────────────────────────────
  getEmbedding(model: string, version: string, contentHash: string): number[] | undefined {
    const r = this.db.prepare('SELECT vector FROM embedding_cache WHERE model=? AND version=? AND content_hash=?').get(model, version, contentHash) as { vector?: Uint8Array } | undefined;
    return r?.vector ? fromBlob(r.vector) : undefined;
  }

  putEmbedding(model: string, version: string, contentHash: string, vector: number[]): void {
    this.db.prepare('INSERT OR REPLACE INTO embedding_cache(model,version,content_hash,dims,vector,created_at) VALUES(?,?,?,?,?,?)')
      .run(model, version, contentHash, vector.length, toBlob(vector), Date.now());
  }

  // ── WorkspacePersistence ─────────────────────────────────────────────────
  saveWorkspace(w: import('./types.js').PersistedWorkspace): void {
    this.db.prepare(
      `INSERT INTO workspaces(id,owner_scope,workspace_scope,name,root,git_repo,git_branch,memory_mode,index_id,provider_preferences,permissions,last_sync_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, root=excluded.root, git_repo=excluded.git_repo, git_branch=excluded.git_branch,
         memory_mode=excluded.memory_mode, index_id=excluded.index_id, provider_preferences=excluded.provider_preferences,
         permissions=excluded.permissions, last_sync_at=excluded.last_sync_at, updated_at=excluded.updated_at`,
    ).run(w.id, w.ownerScope, w.workspaceScope, w.name, w.root, w.gitRepo ?? null, w.gitBranch ?? null, w.memoryMode, w.indexId ?? null, w.providerPreferences ?? null, w.permissions ?? null, w.lastSyncAt ?? null, w.createdAt, w.updatedAt);
  }

  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id=?').run(id);
  }

  loadWorkspaces(): import('./types.js').PersistedWorkspace[] {
    return (this.db.prepare('SELECT * FROM workspaces').all() as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, ownerScope: r.owner_scope as string, workspaceScope: r.workspace_scope as string, name: r.name as string, root: r.root as string,
      gitRepo: (r.git_repo as string) ?? undefined, gitBranch: (r.git_branch as string) ?? undefined, memoryMode: r.memory_mode as string,
      indexId: (r.index_id as string) ?? undefined, providerPreferences: (r.provider_preferences as string) ?? undefined, permissions: (r.permissions as string) ?? undefined,
      lastSyncAt: (r.last_sync_at as number) ?? undefined, createdAt: r.created_at as number, updatedAt: r.updated_at as number,
    }));
  }

  pruneOlderThan(cutoffMs: number): number {
    const before = (this.db.prepare('SELECT count(*) c FROM embedding_cache').get() as { c: number }).c;
    this.db.prepare('DELETE FROM embedding_cache WHERE created_at < ?').run(cutoffMs);
    const after = (this.db.prepare('SELECT count(*) c FROM embedding_cache').get() as { c: number }).c;
    return before - after;
  }

  /** Remove index_versions rows with no matching active index (orphan cleanup). */
  cleanupOrphanVersions(): number {
    const res = this.db.prepare('DELETE FROM index_versions WHERE index_id NOT IN (SELECT id FROM workspace_indexes)').run();
    // Also drop orphan chunks (defensive — a delete already cascades).
    this.db.prepare('DELETE FROM index_chunks WHERE index_id NOT IN (SELECT id FROM workspace_indexes)').run();
    return Number(res.changes ?? 0);
  }

  /** SQLite integrity verification. Returns 'ok' or the first problem reported. */
  integrityCheck(): string {
    const rows = this.db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    return rows[0]?.integrity_check ?? 'unknown';
  }

  /** Online backup to a file path (safe while the engine runs). */
  backupTo(destPath: string): void {
    // VACUUM INTO produces a consistent single-file snapshot.
    this.db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  }
}

function rowToConversation(r: Record<string, unknown>): Conversation {
  return { id: r.id as string, ownerScope: r.owner_scope as string, workspaceScope: r.workspace_scope as string, title: r.title as string, memoryMode: r.memory_mode as Conversation['memoryMode'], createdAt: r.created_at as number, updatedAt: r.updated_at as number };
}
function rowToMessage(r: Record<string, unknown>): Message {
  return { id: r.id as string, conversationId: r.conversation_id as string, role: r.role as Message['role'], content: r.content as string, status: r.status as Message['status'], requestId: (r.request_id as string) ?? undefined, modelId: (r.model_id as string) ?? undefined, providerId: (r.provider_id as string) ?? undefined, createdAt: r.created_at as number, durable: (r.durable as number) === 1, supersedesId: (r.supersedes_id as string) ?? undefined };
}
function rowToSummary(r: Record<string, unknown>): Summary {
  return { id: r.id as string, conversationId: r.conversation_id as string, sourceFromMessageId: r.source_from_message_id as string, sourceToMessageId: r.source_to_message_id as string, summary: JSON.parse(r.summary_json as string), version: r.version as number, createdAt: r.created_at as number };
}
