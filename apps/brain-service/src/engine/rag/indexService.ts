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

/** Classified failure text for status/health — never indexed source. */
function faultOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : String(error);
}

export interface FileSource {
  /** Workspace-relative files that are candidates for indexing (already bounded). */
  files(): Promise<Array<{ relPath: string; content: string }>>;
}

export interface IndexRecord {
  id: string;
  workspaceId: string;
  sourceType: 'workspace' | 'docs';
  root: string;
  /** Lifecycle of the LATEST candidate. NOT what production retrieval serves. */
  state: IndexState;
  syncing: boolean;
  /** Latest successfully committed candidate version. */
  version: number;
  /**
   * Version authorised for production retrieval, or undefined when none is.
   *
   * Independent of {@link state}: a successful candidate sync advances `version`
   * and leaves this pointing at the reviewed version, so approved content keeps
   * serving while the replacement is reviewed. Approval used to be the
   * version-agnostic `state` string, which made a candidate approved the instant
   * it committed — including a candidate nobody had looked at.
   */
  approvedVersion?: number;
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
  /** The LATEST candidate version's content — what inspection reads. */
  index: VectorIndex;
  /**
   * The APPROVED version's content — what `requireApproved` reads. Shares the
   * object with {@link index} while the approved version IS the latest; they
   * diverge as soon as a candidate is committed on top of an approved version.
   */
  approvedIndex?: VectorIndex;
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
  async hydrate(): Promise<void> {
    if (!this.persistence) return;
    for (const rec of await this.persistence.loadIndexes()) {
      const record: IndexRecord = {
        id: rec.id, workspaceId: rec.workspaceId, sourceType: rec.sourceType as 'workspace' | 'docs', root: rec.root,
        state: rec.state as IndexState, syncing: false, version: rec.version, embeddingModel: rec.embeddingModel,
        embeddingVersion: rec.embeddingVersion, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
        stats: { files: 0, chunks: 0, approxBytes: 0, lastSyncMs: 0 },
      };
      record.approvedVersion = rec.approvedVersion;

      // ── The APPROVED version loads independently of the candidate ───────────
      // A damaged CANDIDATE must not cost the reviewed content its approval, and a
      // damaged APPROVED version must lose the pointer rather than serve junk.
      let approvedIndex: VectorIndex | undefined;
      if (rec.approvedVersion !== undefined) {
        try {
          approvedIndex = await this.loadVersion(rec.id, rec.approvedVersion);
        } catch (error) {
          record.approvedVersion = undefined;
          record.state = 'degraded';
          record.stats.lastError = faultOf(error);
          // Revoke durably: approved content we cannot decode must never be served.
          // "Durably" is the whole point, so both writes are awaited — fired and
          // forgotten, they lose to the next restart and the junk stays approved.
          await this.persistence.setApprovedVersion(rec.id, null, this.now());
          await this.persistence.setIndexState(rec.id, 'degraded', this.now());
        }
      }

      try {
        const index = rec.approvedVersion !== undefined && rec.approvedVersion === rec.version && approvedIndex
          ? approvedIndex // same version — one object, not two copies
          : await this.loadVersion(rec.id, rec.version);
        record.stats = { files: index.files().length, chunks: index.size(), approxBytes: index.approxBytes(), lastSyncMs: 0, lastError: record.stats.lastError };
        this.byId.set(rec.id, { record, index, approvedIndex: approvedIndex ?? (record.approvedVersion !== undefined ? index : undefined) });
      } catch (error) {
        // ── QUARANTINE, never crash ────────────────────────────────────────────
        // One damaged vector used to throw a raw TypeError straight out of startup
        // ("Cannot read properties of null (reading 'buffer')") as an unhandled
        // rejection — the Brain refused to boot at all until the database was
        // deleted. The damaged CANDIDATE is demoted and kept EMPTY so it can never
        // serve partial content, while a healthy approved version keeps serving.
        // The reason is a classified fault, never indexed source.
        record.state = 'degraded';
        record.stats = { files: 0, chunks: 0, approxBytes: 0, lastSyncMs: 0, lastError: faultOf(error) };
        this.byId.set(rec.id, { record, index: new VectorIndex(), approvedIndex });
        await this.persistence.setIndexState(rec.id, 'degraded', this.now());
      }
    }
  }

  /** Build an in-memory index from ONE persisted version. Throws if any vector
   * in that version is damaged (all-or-nothing — never a partial index). */
  private async loadVersion(indexId: string, indexVersion: number): Promise<VectorIndex> {
    const index = new VectorIndex();
    const byFile = new Map<string, IndexedChunk[]>();
    for (const c of await this.persistence!.loadChunks(indexId, indexVersion)) {
      const chunk: IndexedChunk = { ...c, symbol: c.symbol };
      (byFile.get(c.filePath) ?? byFile.set(c.filePath, []).get(c.filePath)!).push(chunk);
    }
    for (const [file, chunks] of byFile) index.replaceFile(file, chunks);
    return index;
  }

  /**
   * Asynchronous because the durable write is: the record is registered in memory
   * only AFTER `saveIndex` lands. Fired and forgotten, a failed save left an index
   * that existed for this process and vanished on restart — callers had already
   * been handed its id and bound workspaces to it.
   */
  async createIndex(scope: Scope, params: { sourceType?: 'workspace' | 'docs'; root: string }): Promise<IndexRecord> {
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
    await this.persistence?.saveIndex(this.toPersisted(record, scope.owner));
    this.byId.set(record.id, { record, index: new VectorIndex() });
    return record;
  }

  private toPersisted(record: IndexRecord, owner: string) {
    return {
      id: record.id, workspaceId: record.workspaceId, ownerScope: owner, sourceType: record.sourceType, root: record.root,
      state: record.state, version: record.version, approvedVersion: record.approvedVersion,
      embeddingModel: record.embeddingModel, embeddingVersion: record.embeddingVersion,
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

  /** Durable deletion first: dropping it from memory while the row survived meant
   * the index came back on the next boot, after the caller was told it was gone. */
  async delete(id: string, scope: Scope): Promise<boolean> {
    if (!this.entry(id, scope)) return false;
    await this.persistence?.deleteIndex(id);
    return this.byId.delete(id);
  }

  /**
   * Move the candidate's lifecycle state, and — for `approved` — promote the
   * approval pointer to the version being approved.
   *
   * Promotion is ATOMIC from a reader's perspective: the pointer and the served
   * content move in the same synchronous step, so `requireApproved` retrieval
   * switches from the old version to the new one with nothing in between.
   *
   * That property is PRESERVED now the method is asynchronous: the durable writes
   * are awaited FIRST, and every in-memory mutation happens afterwards in one
   * synchronous block with no `await` between the pointer and the served content.
   * A reader can still never observe a half-promoted index.
   *
   * Persisting first is the point. Approving in memory and then firing the writes
   * meant a failed write left this process serving content as `approved` that the
   * database still called a candidate — the divergence survives until a restart
   * silently demotes it.
   *
   * Demoting a candidate (`evaluated`/`experimental`/`degraded`) deliberately does
   * NOT revoke approval — that is exactly the "v6 committed, v5 still serving"
   * state. Only damaged approved content or an explicit revoke clears the pointer.
   */
  async setState(id: string, scope: Scope, state: IndexState): Promise<IndexRecord | undefined> {
    const e = this.entry(id, scope);
    if (!e) return undefined;
    const updatedAt = this.now();
    if (state === 'approved') {
      await this.persistence?.setApprovedVersion(id, e.record.version, updatedAt);
    }
    await this.persistence?.setIndexState(id, state, updatedAt);
    // ── memory, all at once, only now that the record is durable ──
    e.record.state = state;
    e.record.updatedAt = updatedAt;
    if (state === 'approved') {
      e.record.approvedVersion = e.record.version;
      e.approvedIndex = e.index; // the reviewed content becomes the served content
    }
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

      // ── Everything that can FAIL happens before the commit ─────────────────
      // `approxBytes()` used to run after `commitSync` and threw on a bad vector,
      // which turned an already-committed sync into a reported failure: the DB had
      // the new content while memory kept the old index, and the API still said
      // "the previous index is unchanged". Computing the stats first leaves nothing
      // fallible after the durable write.
      const nextVersion = e.record.version + 1;
      const nextStats = {
        files: staging.files().length,
        chunks: staging.size(),
        approxBytes: staging.approxBytes(),
        lastSyncMs: 0,
        lastError: undefined as string | undefined,
      };

      // Durable commit (one transaction). It validates every vector before BEGIN,
      // so an invalid candidate throws here having written nothing.
      if (this.persistence) {
        // AWAITED, or the swap below is not "only after the durable commit
        // succeeded" — it is concurrent with it. Un-awaited, a commit that threw
        // (an invalid vector, a rolled-back transaction) surfaced as an unhandled
        // rejection while control fell through to the swap, so memory adopted a
        // version the database never accepted and the catch never ran.
        await this.persistence.commitSync(e.record.id, nextVersion, changedChunks.map((c) => this.toPersistedChunk(e.record.id, c)), changedFiles, deletedFiles, this.now());
      }

      // Atomic swap — only after the durable commit succeeded. Assignments only:
      // nothing below may throw, or memory and the database diverge again.
      e.index = staging;
      e.record.version = nextVersion;
      e.record.updatedAt = this.now();
      e.record.syncing = false;
      if (e.record.state === 'degraded') e.record.state = 'experimental';
      // Mirror the demotion `commitSync` performed durably: a freshly committed
      // candidate awaits review, even though the approved version keeps serving.
      if (e.record.state === 'approved' && e.record.approvedVersion !== nextVersion) e.record.state = 'evaluated';
      nextStats.lastSyncMs = this.now() - started;
      e.record.stats = nextStats;
      return { ok: true, record: e.record };
    } catch (error) {
      // The prior index really is untouched: validation happens before BEGIN and
      // the transaction rolls back, so nothing durable changed.
      e.record.syncing = false;
      e.record.state = 'degraded';
      e.record.stats.lastError = error instanceof Error ? error.message.slice(0, 120) : String(error);
      e.record.updatedAt = this.now();
      // Durable AND honest: without this the database kept the pre-sync state
      // string (often `approved`) while memory said `degraded`, so a restart
      // resurrected the index as approved with no record of the failure.
      // Awaited for the same reason it exists: an un-awaited demotion that loses
      // its race with the caller closing the store is the resurrection bug again.
      await this.persistence?.setIndexState(e.record.id, 'degraded', e.record.updatedAt);
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
    if (e.record.state === 'disabled') return { ok: false, code: 'DISABLED', error: 'Index is disabled.' };
    // Production retrieval is bound to the APPROVED VERSION, not to the `state`
    // string. Gating on state alone served whatever content happened to be latest,
    // so a candidate committed on top of an approved index was served as approved.
    let source = e.index;
    if (opts.requireApproved) {
      if (e.record.approvedVersion === undefined || !e.approvedIndex) {
        return { ok: false, code: 'NOT_APPROVED', error: 'Index is not approved for production retrieval.' };
      }
      source = e.approvedIndex;
    }
    const [queryVec] = await this.embedder.embed([queryText]);
    const { chunks, diagnostics } = await hybridRetrieve(source, queryVec!, queryText, opts);
    return { ok: true, chunks, diagnostics, indexState: e.record.state };
  }

  /** First approved index for a workspace (for chat integration). */
  approvedIndexFor(scope: Scope): string | undefined {
    for (const [id, e] of this.byId) if (e.record.workspaceId === scope.workspace && e.record.approvedVersion !== undefined) return id;
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
