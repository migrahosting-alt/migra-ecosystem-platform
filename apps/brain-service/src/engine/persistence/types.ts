/**
 * MigraAI Engine — durable persistence abstraction.
 *
 * The engine is the ONLY writer of these records; clients never touch the store.
 * Adapters keep the engine independent of any one database: an embedded SQLite
 * adapter backs the local engine today; a Postgres+pgvector adapter can back a
 * hosted/multi-tenant deployment later without changing the engine.
 *
 * Every row carries owner + workspace scope so isolation is enforced in QUERIES,
 * not only in application code. Callers pass already-redacted content — no
 * secrets, approval tokens, chain-of-thought, or unsanitized tool payloads ever
 * reach an adapter (redaction happens at the store boundary above these).
 */

import type { Conversation, Message, Summary, MemoryItem, Scope } from '../memory/conversationStore.js';

export type StoreHealth = 'ready' | 'degraded' | 'unavailable';

export interface PersistenceHealth {
  memoryStore: StoreHealth;
  ragStore: StoreHealth;
  schemaVersion: number;
  /** e.g. 'applied', 'pending', 'mismatch', 'failed'. */
  migrationState: string;
  detail?: string;
}

// ── Conversation memory ──────────────────────────────────────────────────────
export interface ConversationPersistence {
  saveConversation(c: Conversation): void;
  /** Hard cascade delete: the conversation + its messages + summaries, so a
   * deleted conversation is inaccessible after restart. */
  deleteConversation(id: string): void;
  saveMessage(m: Message): void;
  saveSummary(s: Summary): void;
  /** Hydrate durable conversations + their messages (in order) + summaries. */
  loadDurable(): { conversations: Conversation[]; messages: Message[]; summaries: Summary[] };
}

// ── Memory items (workspace facts / user prefs) ──────────────────────────────
export interface MemoryItemPersistence {
  saveMemoryItem(item: MemoryItem): void;
  loadMemoryItems(): MemoryItem[];
}

// ── RAG indexes ──────────────────────────────────────────────────────────────
export interface PersistedIndexRecord {
  id: string;
  workspaceId: string;
  ownerScope: string;
  sourceType: string;
  root: string;
  state: string;
  version: number;
  embeddingModel: string;
  embeddingVersion: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedChunk {
  id: string;
  indexId: string;
  workspaceId: string;
  filePath: string;
  language: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  embeddingModel: string;
  embeddingVersion: string;
  indexedAt: number;
  text: string;
  vector: number[];
}

export interface RagIndexPersistence {
  saveIndex(rec: PersistedIndexRecord): void;
  deleteIndex(id: string): void;
  setIndexState(id: string, state: string, updatedAt: number): void;
  /**
   * Atomically replace the persisted chunk set for a set of files within one
   * index: `changed` files' chunks are rewritten, `deletedFiles` are removed, and
   * the index version is bumped — all in one transaction. A failure leaves the
   * previous persisted version intact (never a partial write).
   */
  commitSync(indexId: string, version: number, changed: PersistedChunk[], changedFiles: string[], deletedFiles: string[], updatedAt: number): void;
  loadIndexes(): PersistedIndexRecord[];
  loadChunks(indexId: string): PersistedChunk[];
}

// ── Embedding cache ──────────────────────────────────────────────────────────
export interface EmbeddingCachePersistence {
  /** Look up a cached vector keyed by (model, version, contentHash) — an
   * embedding from one model/version is NEVER returned for another. */
  getEmbedding(model: string, version: string, contentHash: string): number[] | undefined;
  putEmbedding(model: string, version: string, contentHash: string, vector: number[]): void;
  pruneOlderThan(cutoffMs: number): number;
}

// ── Workspaces ───────────────────────────────────────────────────────────────
export interface PersistedWorkspace {
  id: string;
  ownerScope: string;
  workspaceScope: string;
  name: string;
  root: string;
  gitRepo?: string;
  gitBranch?: string;
  memoryMode: string;
  indexId?: string;
  providerPreferences?: string;
  permissions?: string;
  lastSyncAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspacePersistence {
  saveWorkspace(w: PersistedWorkspace): void;
  deleteWorkspace(id: string): void;
  loadWorkspaces(): PersistedWorkspace[];
}

/** A composite durable store exposing every persistence facet + health. */
export interface DurableStore extends ConversationPersistence, MemoryItemPersistence, RagIndexPersistence, EmbeddingCachePersistence, WorkspacePersistence {
  health(): PersistenceHealth;
  close(): void;
}

/** Scope guard used by adapters to build scoped WHERE clauses. */
export function scopeKey(scope: Scope): { owner: string; workspace: string } {
  return { owner: scope.owner, workspace: scope.workspace };
}
