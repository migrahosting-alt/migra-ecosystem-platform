/**
 * MigraAI Engine — RAG index service.
 *
 * Owns the index lifecycle per workspace: create, (incremental) sync, status,
 * delete, and retrieve. Guarantees:
 *  - workspace isolation: an index is only visible/searchable within its scope;
 *  - atomicity: a sync builds a STAGING clone and swaps it in only on success —
 *    a partial or failed run never replaces the active index;
 *  - embedding-failure safety: if embedding throws, the prior index is kept and
 *    the index is marked `degraded`;
 *  - incremental: unchanged files (same content hashes) are not re-embedded;
 *  - cleanup: files gone from disk have their chunks removed (stale invalidation);
 *  - exclusions: secrets/binary/generated/gitignored paths never enter the index.
 *
 * Promotion states mirror the model pipeline: experimental → evaluated → approved
 * · degraded · disabled. Only `approved` indexes back production chat RAG.
 */

import { Exclusions, DEFAULT_MIGRAAI_EXCLUSIONS } from './exclusions.js';
import { chunkFile } from './chunker.js';
import type { Embedder } from './embedder.js';
import { VectorIndex, type IndexedChunk } from './vectorIndex.js';
import { hybridRetrieve, type HybridOptions, type RetrievedRagChunk, type RetrieveDiagnostics } from './hybridRetriever.js';
import type { RagIndexPersistence, PersistedChunk } from '../persistence/types.js';

export type IndexState = 'experimental' | 'evaluated' | 'approved' | 'degraded' | 'disabled';

export interface FileSource {
  /** Workspace-relative files that are candidates for indexing (already bounded). */
  files(): Promise<Array<{ relPath: string; content: string }>>;
}

export interface IndexRecord {
  id: string;
  workspaceId: string;
  sourceType: 'workspace' | 'docs';
  root: string;
  state: IndexState;
  syncing: boolean;
  version: number;
  embeddingModel: string;
  embeddingVersion: string;
  createdAt: number;
  updatedAt: number;
  stats: { files: number; chunks: number; approxBytes: number; lastSyncMs: number; lastError?: string };
}

export interface Scope {
  owner: string;
  workspace: string;
}

interface Entry {
  record: IndexRecord;
  index: VectorIndex;
}

export class IndexService {
  private readonly byId = new Map<string, Entry>();

  constructor(
    private readonly embedder: Embedder,
    /** Builds a file source for an index (injected so tests avoid the real FS). */
    private readonly sourceFactory: (record: IndexRecord) => FileSource,
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = () => `idx_${Math.random().toString(36).slice(2, 12)}`,
    /** Durable persistence for index records + chunks (optional; in-memory only
     * when absent). */
    private readonly persistence?: RagIndexPersistence,
  ) {}

  /** Rebuild in-memory indexes from durable storage on startup — approved indexes
   * and their chunks/vectors survive a restart, so unchanged files are not
   * re-embedded. */
  hydrate(): void {
    if (!this.persistence) return;
    for (const rec of this.persistence.loadIndexes()) {
      const record: IndexRecord = {
        id: rec.id, workspaceId: rec.workspaceId, sourceType: rec.sourceType as 'workspace' | 'docs', root: rec.root,
        state: rec.state as IndexState, syncing: false, version: rec.version, embeddingModel: rec.embeddingModel,
        embeddingVersion: rec.embeddingVersion, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
        stats: { files: 0, chunks: 0, approxBytes: 0, lastSyncMs: 0 },
      };
      const index = new VectorIndex();
      const byFile = new Map<string, IndexedChunk[]>();
      for (const c of this.persistence.loadChunks(rec.id)) {
        const chunk: IndexedChunk = { ...c, symbol: c.symbol };
        (byFile.get(c.filePath) ?? byFile.set(c.filePath, []).get(c.filePath)!).push(chunk);
      }
      for (const [file, chunks] of byFile) index.replaceFile(file, chunks);
      record.stats = { files: index.files().length, chunks: index.size(), approxBytes: index.approxBytes(), lastSyncMs: 0 };
      this.byId.set(rec.id, { record, index });
    }
  }

  createIndex(scope: Scope, params: { sourceType?: 'workspace' | 'docs'; root: string }): IndexRecord {
    const t = this.now();
    const record: IndexRecord = {
      id: this.mkId(),
      workspaceId: scope.workspace,
      sourceType: params.sourceType ?? 'workspace',
      root: params.root,
      state: 'experimental',
      syncing: false,
      version: 0,
      embeddingModel: this.embedder.model,
      embeddingVersion: this.embedder.version,
      createdAt: t,
      updatedAt: t,
      stats: { files: 0, chunks: 0, approxBytes: 0, lastSyncMs: 0 },
    };
    this.byId.set(record.id, { record, index: new VectorIndex() });
    this.persistence?.saveIndex(this.toPersisted(record, scope.owner));
    return record;
  }

  private toPersisted(record: IndexRecord, owner: string) {
    return {
      id: record.id, workspaceId: record.workspaceId, ownerScope: owner, sourceType: record.sourceType, root: record.root,
      state: record.state, version: record.version, embeddingModel: record.embeddingModel, embeddingVersion: record.embeddingVersion,
      createdAt: record.createdAt, updatedAt: record.updatedAt,
    };
  }

  private toPersistedChunk(indexId: string, c: IndexedChunk): PersistedChunk {
    return {
      id: c.id, indexId, workspaceId: c.workspaceId, filePath: c.filePath, language: c.language, symbol: c.symbol,
      startLine: c.startLine, endLine: c.endLine, contentHash: c.contentHash, embeddingModel: c.embeddingModel,
      embeddingVersion: c.embeddingVersion, indexedAt: c.indexedAt, text: c.text, vector: c.vector,
    };
  }

  private entry(id: string, scope: Scope): Entry | undefined {
    const e = this.byId.get(id);
    if (!e || e.record.workspaceId !== scope.workspace) return undefined; // isolation
    return e;
  }

  status(id: string, scope: Scope): IndexRecord | undefined {
    return this.entry(id, scope)?.record;
  }

  delete(id: string, scope: Scope): boolean {
    if (!this.entry(id, scope)) return false;
    this.persistence?.deleteIndex(id);
    return this.byId.delete(id);
  }

  setState(id: string, scope: Scope, state: IndexState): IndexRecord | undefined {
    const e = this.entry(id, scope);
    if (!e) return undefined;
    e.record.state = state;
    e.record.updatedAt = this.now();
    this.persistence?.setIndexState(id, state, e.record.updatedAt);
    return e.record;
  }

  /** Incremental, atomic sync. Returns the record or an error string. */
  async sync(id: string, scope: Scope): Promise<{ ok: true; record: IndexRecord } | { ok: false; code: string; error: string }> {
    const e = this.entry(id, scope);
    if (!e) return { ok: false, code: 'UNKNOWN_INDEX', error: 'Index not found.' };
    const started = this.now();
    e.record.syncing = true;
    try {
      const source = this.sourceFactory(e.record);
      const files = await source.files();
      const staging = e.index.clone(); // build into a staging copy
      const seen = new Set<string>();
      const changedFiles: string[] = [];
      const changedChunks: IndexedChunk[] = [];

      for (const f of files) {
        seen.add(f.relPath);
        const raw = chunkFile(f.relPath, f.content);
        const newHashes = new Set(raw.map((c) => c.contentHash));
        const existing = staging.fileHashes(f.relPath);
        const unchanged = existing.size === newHashes.size && [...newHashes].every((h) => existing.has(h));
        if (unchanged) continue; // incremental: skip re-embedding

        const vectors = raw.length ? await this.embedder.embed(raw.map((c) => c.text)) : [];
        const chunks: IndexedChunk[] = raw.map((c, i) => ({
          id: `${f.relPath}#${c.startLine}`,
          workspaceId: scope.workspace,
          filePath: c.filePath,
          language: c.language,
          symbol: c.symbol,
          startLine: c.startLine,
          endLine: c.endLine,
          contentHash: c.contentHash,
          embeddingModel: this.embedder.model,
          embeddingVersion: this.embedder.version,
          indexedAt: this.now(),
          text: c.text,
          vector: vectors[i]!,
        }));
        staging.replaceFile(f.relPath, chunks);
        changedFiles.push(f.relPath);
        changedChunks.push(...chunks);
      }

      // Deleted-file cleanup: files in the index but gone from disk.
      const deletedFiles: string[] = [];
      for (const file of staging.files()) if (!seen.has(file)) { staging.removeFile(file); deletedFiles.push(file); }

      // Durable commit FIRST (one transaction). If it throws, we keep the prior
      // in-memory index (the catch below marks degraded) — never a partial swap.
      const nextVersion = e.record.version + 1;
      if (this.persistence) {
        this.persistence.commitSync(e.record.id, nextVersion, changedChunks.map((c) => this.toPersistedChunk(e.record.id, c)), changedFiles, deletedFiles, this.now());
      }

      // Atomic swap — only after the durable commit succeeded.
      e.index = staging;
      e.record.version = nextVersion;
      e.record.updatedAt = this.now();
      e.record.syncing = false;
      if (e.record.state === 'degraded') e.record.state = 'experimental';
      e.record.stats = {
        files: staging.files().length,
        chunks: staging.size(),
        approxBytes: staging.approxBytes(),
        lastSyncMs: this.now() - started,
        lastError: undefined,
      };
      return { ok: true, record: e.record };
    } catch (error) {
      // Keep the prior valid index; mark degraded.
      e.record.syncing = false;
      e.record.state = 'degraded';
      e.record.stats.lastError = error instanceof Error ? error.message.slice(0, 120) : String(error);
      e.record.updatedAt = this.now();
      return { ok: false, code: 'SYNC_FAILED', error: 'Indexing failed; the previous index is unchanged.' };
    }
  }

  /** Retrieve from an index (scope-checked). `requireApproved` gates production use. */
  async retrieve(
    id: string,
    scope: Scope,
    queryText: string,
    opts: HybridOptions & { requireApproved?: boolean } = {},
  ): Promise<{ ok: true; chunks: RetrievedRagChunk[]; diagnostics: RetrieveDiagnostics; indexState: IndexState } | { ok: false; code: string; error: string }> {
    const e = this.entry(id, scope);
    if (!e) return { ok: false, code: 'UNKNOWN_INDEX', error: 'Index not found.' };
    if (opts.requireApproved && e.record.state !== 'approved') {
      return { ok: false, code: 'NOT_APPROVED', error: 'Index is not approved for production retrieval.' };
    }
    if (e.record.state === 'disabled') return { ok: false, code: 'DISABLED', error: 'Index is disabled.' };
    const [queryVec] = await this.embedder.embed([queryText]);
    const { chunks, diagnostics } = await hybridRetrieve(e.index, queryVec!, queryText, opts);
    return { ok: true, chunks, diagnostics, indexState: e.record.state };
  }

  /** First approved index for a workspace (for chat integration). */
  approvedIndexFor(scope: Scope): string | undefined {
    for (const [id, e] of this.byId) if (e.record.workspaceId === scope.workspace && e.record.state === 'approved') return id;
    return undefined;
  }

  listForScope(scope: Scope): IndexRecord[] {
    return [...this.byId.values()].filter((e) => e.record.workspaceId === scope.workspace).map((e) => e.record);
  }

  /** Build the default MigraAI exclusions for a root (loads .gitignore). */
  static exclusionsFor(gitignore?: string): Exclusions {
    return new Exclusions({ gitignore, extra: DEFAULT_MIGRAAI_EXCLUSIONS });
  }
}
