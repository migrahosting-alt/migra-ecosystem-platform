/**
 * MigraAI Engine — PostgreSQL RAG persistence (Group 3).
 *
 * ── Why no pgvector ────────────────────────────────────────────────────────
 * The store interface performs no similarity search. `loadChunks(indexId,
 * version)` bulk-loads one version; ranking lives in `engine/rag/vectorIndex.ts`
 * and `hybridRetriever.ts`. Introducing pgvector would add a distance operator
 * and index type that nothing queries, and would invite a silent change of
 * ranking semantics. Vectors are therefore stored as BYTEA carrying the exact
 * little-endian Float32 encoding SQLite uses, so round-trips are bit-identical.
 *
 * ── embedding_cache classification: GLOBAL-SAFE ────────────────────────────
 * Columns: model, version, content_hash, dims, vector, created_at.
 * PK: (model, version, content_hash).
 *
 *   • no owner/workspace/tenant identifier
 *   • no source text — only a content hash
 *   • no file path, document id, or provenance
 *   • the value is a deterministic function of content, not of who embedded it
 *
 * It is therefore shared, with NO RLS, exactly as SQLite has it. One caveat is
 * documented rather than hidden: the cache is a HIT ORACLE. A caller who
 * already possesses content X can hash it and learn that *someone* embedded X.
 * It confirms rather than reveals — the prober must already hold the content,
 * and no tenant identity is returned — but it is a real cross-tenant signal. If
 * that ever becomes unacceptable, the fix is to salt the key per tenant, which
 * forfeits all sharing; that trade-off should be a deliberate decision.
 */

import type { PoolClient } from 'pg';
import type { PersistedChunk, PersistedIndexRecord } from '../types.js';
import type { ScopedRequest } from './conversationRepo.js';

export class InvalidVectorError extends Error {
  readonly code = 'INVALID_VECTOR';
  constructor(reason: string, chunkId?: string) {
    super(`invalid vector${chunkId ? ` for chunk ${chunkId}` : ''}: ${reason}`);
    this.name = 'InvalidVectorError';
  }
}

/** Mirrors the SQLite adapter's encoding exactly: Float32, little-endian. */
export function toVectorBytes(vec: number[] | undefined, chunkId?: string): Buffer {
  if (!Array.isArray(vec) || vec.length === 0) throw new InvalidVectorError('empty-vector', chunkId);
  for (const n of vec) {
    if (!Number.isFinite(n)) throw new InvalidVectorError('non-finite', chunkId);
  }
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Decode with the SAME validation ladder as the SQLite adapter, so failure
 * behaviour is identical rather than merely similar: null, empty, misaligned,
 * wrong-dims, non-finite.
 */
export function fromVectorBytes(buf: unknown, expectedDims?: number, chunkId?: string): number[] {
  if (buf === null || buf === undefined) throw new InvalidVectorError('null-blob', chunkId);
  if (!(buf instanceof Uint8Array)) throw new InvalidVectorError('null-blob', chunkId);
  if (buf.byteLength === 0) throw new InvalidVectorError('empty-blob', chunkId);
  if (buf.byteLength % 4 !== 0) throw new InvalidVectorError('misaligned-blob', chunkId);

  // Copy the EXACT bytes into a fresh buffer.
  //
  // `buf.slice().buffer` is wrong here: `pg` hands back a Node Buffer, and
  // `Buffer.prototype.slice` shares memory rather than copying (it behaves like
  // `subarray`). Its `.buffer` is therefore the whole 8 KB allocation pool, so
  // a 3-element vector decoded as 2048 elements and every read failed
  // `wrong-dims`. The SQLite adapter is unaffected because it receives a plain
  // Uint8Array, whose `slice` does copy.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  const f = new Float32Array(copy.buffer);
  if (expectedDims !== undefined && f.length !== expectedDims) throw new InvalidVectorError('wrong-dims', chunkId);
  for (const n of f) {
    if (!Number.isFinite(n)) throw new InvalidVectorError('non-finite', chunkId);
  }
  return Array.from(f);
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

// ── indexes ─────────────────────────────────────────────────────────────────

/**
 * A scoped mutation that changed nothing.
 *
 * Under FORCE row-level security an UPDATE or DELETE whose scope was not
 * declared — or was declared wrongly — matches ZERO rows and returns without
 * error. That is not "best effort": it is an unauthorized statement that
 * silently did nothing, and reporting success from it is a durability lie of
 * exactly the kind this codebase already rejected for durable writes.
 *
 * Proven, not theorised: approving an index persisted nothing because the
 * UPDATE was unscoped, memory said `approved`, the database said
 * `experimental`, and the approval vanished on the next restart.
 */
export class ScopedMutationMissedError extends Error {
  readonly code = 'SCOPED_MUTATION_MISSED';
  constructor(readonly statement: string, readonly id: string) {
    super(
      `${statement} affected no rows for id '${id}'. Either the row does not exist or it is outside the declared scope; ` +
        'either way nothing was changed.',
    );
    this.name = 'ScopedMutationMissedError';
  }
}

/** Require a scoped mutation to have actually changed something. */
export function requireAffected(rowCount: number | null, statement: string, id: string): void {
  if (!rowCount) throw new ScopedMutationMissedError(statement, id);
}

export async function saveIndex(
  client: PoolClient,
  rec: PersistedIndexRecord,
  scope: ScopedRequest,
): Promise<void> {
  // Reuses workspace_indexes from Group 2; scope columns are omitted from the
  // conflict update so an index cannot be re-homed by re-saving it.
  await client.query(
    `INSERT INTO workspace_indexes
       (id, workspace_id, owner_scope, workspace_scope, source_type, root, state, version,
        embedding_model, embedding_version, created_at, updated_at, approved_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       workspace_id      = EXCLUDED.workspace_id,
       source_type       = EXCLUDED.source_type,
       root              = EXCLUDED.root,
       state             = EXCLUDED.state,
       version           = EXCLUDED.version,
       embedding_model   = EXCLUDED.embedding_model,
       embedding_version = EXCLUDED.embedding_version,
       updated_at        = EXCLUDED.updated_at`,
    [
      rec.id, rec.workspaceId, scope.ownerScope, scope.workspaceScope, rec.sourceType, rec.root,
      rec.state, rec.version, rec.embeddingModel, rec.embeddingVersion,
      rec.createdAt, rec.updatedAt, rec.approvedVersion ?? null,
    ],
  );
}

/** Cascade order matches SQLite: chunks → versions → index record. */
export async function deleteIndex(client: PoolClient, id: string): Promise<void> {
  // Children first, then the parent. Only the PARENT's row count is required:
  // an index legitimately has no chunks or versions yet, so demanding rows there
  // would fail a correct delete. The parent is the fact being asserted.
  await client.query('DELETE FROM index_chunks WHERE index_id = $1', [id]);
  await client.query('DELETE FROM index_versions WHERE index_id = $1', [id]);
  const r = await client.query('DELETE FROM workspace_indexes WHERE id = $1', [id]);
  requireAffected(r.rowCount, 'deleteIndex', id);
}

export async function setIndexState(
  client: PoolClient, id: string, state: string, updatedAt: number,
): Promise<void> {
  const r = await client.query('UPDATE workspace_indexes SET state = $2, updated_at = $3 WHERE id = $1', [id, state, updatedAt]);
  requireAffected(r.rowCount, 'setIndexState', id);
}

/**
 * Independent of `state`, matching the documented contract: advancing a
 * candidate must never move this pointer, and demoting one must never revoke it.
 */
export async function setApprovedVersion(
  client: PoolClient, id: string, approvedVersion: number | null, updatedAt: number,
): Promise<void> {
  const r = await client.query(
    'UPDATE workspace_indexes SET approved_version = $2, updated_at = $3 WHERE id = $1',
    [id, approvedVersion, updatedAt],
  );
  requireAffected(r.rowCount, 'setApprovedVersion', id);
}

export async function loadIndexes(client: PoolClient): Promise<PersistedIndexRecord[]> {
  const { rows } = await client.query<Record<string, unknown>>('SELECT * FROM workspace_indexes');
  return rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id ?? ''),
    ownerScope: String(r.owner_scope),
    sourceType: String(r.source_type ?? ''),
    root: String(r.root ?? ''),
    state: String(r.state ?? ''),
    ...(r.approved_version !== null && r.approved_version !== undefined
      ? { approvedVersion: num(r.approved_version) } : {}),
    version: num(r.version),
    embeddingModel: String(r.embedding_model ?? ''),
    embeddingVersion: String(r.embedding_version ?? ''),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  }));
}

/**
 * Chunks for ONE version. Never across versions — mixing them would blend
 * approved and candidate content into a single index.
 *
 * SQLite imposes no ORDER BY, so none is imposed here. The dimension ladder is
 * preserved exactly: the first row pins the width and every later row must match.
 */
export async function loadChunks(
  client: PoolClient, indexId: string, indexVersion: number,
): Promise<PersistedChunk[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    'SELECT * FROM index_chunks WHERE index_id = $1 AND index_version = $2',
    [indexId, indexVersion],
  );
  let dims: number | undefined;
  return rows.map((r) => {
    /*
     * RETRIEVAL IDENTITY, NOT THE DATABASE ROW ID.
     *
     * The domain keeps `${relPath}#${startLine}` as a chunk's identity inside
     * its index; `row_id` is a persistence detail the retriever must never have
     * to understand. Coupling them is what would force another migration the
     * next time the storage key changes.
     */
    const vector = fromVectorBytes(r.vector, dims, String(r.chunk_key));
    dims ??= vector.length;
    return {
      id: String(r.chunk_key),
      indexId: String(r.index_id ?? ''),
      workspaceId: String(r.workspace_id ?? ''),
      filePath: String(r.file_path ?? ''),
      language: String(r.language ?? ''),
      ...(optStr(r.symbol) ? { symbol: String(r.symbol) } : {}),
      startLine: num(r.start_line),
      endLine: num(r.end_line),
      contentHash: String(r.content_hash ?? ''),
      embeddingModel: String(r.embedding_model ?? ''),
      embeddingVersion: String(r.embedding_version ?? ''),
      indexedAt: num(r.indexed_at),
      text: String(r.text ?? ''),
      vector,
    };
  });
}

/**
 * Atomically replace the chunk set for the changed files of ONE index version.
 *
 * The caller supplies the transaction; a failure anywhere leaves the previous
 * persisted version intact rather than a partial write.
 */
export async function commitSync(
  client: PoolClient,
  indexId: string,
  version: number,
  changed: PersistedChunk[],
  changedFiles: string[],
  deletedFiles: string[],
  updatedAt: number,
  scope: ScopedRequest,
): Promise<void> {
  const touched = [...new Set([...changedFiles, ...deletedFiles])];

  /*
   * A COMMITTED VERSION IS A COMPLETE SNAPSHOT, NOT A DELTA.
   *
   * `loadChunks(indexId, version)` reads ONE version and treats what it finds as
   * the whole index. Writing only the changed chunks under `version` therefore
   * produced a version that could not stand alone: restart, and every file that
   * happened not to change in the last sync simply vanished.
   *
   * The no-op sync made it obvious — a version with zero chunks, an index that
   * restored empty while still reporting approved, and a user told their own file
   * had "no readable content". The dangerous case is quieter: change ONE file out
   * of ten and the new version holds only that file, so a restart silently drops
   * the other nine and retrieval keeps working against a fraction of the evidence.
   *
   * The SQLite adapter has always carried untouched files forward. This one did
   * not, and production runs PostgreSQL — the bug was an adapter parity gap, not a
   * design disagreement.
   */

  /*
   * Retry-safe, and scoped to the files this sync TOUCHED at this version.
   *
   * Deleting everything at `version` looks tidier and is wrong: a commit may be
   * applied more than once against the same version, and wiping the version first
   * discards rows the caller is not resupplying — turning an incremental commit
   * into data loss. Sibling versions are immutable and are never touched here.
   */
  if (touched.length > 0) {
    await client.query(
      'DELETE FROM index_chunks WHERE index_id = $1 AND index_version = $2 AND file_path = ANY($3::text[])',
      [indexId, version, touched],
    );
  }

  /*
   * The version this commit SUPERSEDES is `version - 1`, derived arithmetically
   * and never read from `workspace_indexes.version`.
   *
   * That pointer is mutable and does not always mean "the version before this
   * one". A legacy import replays historical versions in order while the pointer
   * already sits at the newest, so carrying forward from it injected rows from a
   * LATER version into an earlier one — the import stopped being idempotent and
   * reconciliation reported chunks Postgres had and SQLite did not.
   *
   * Sync only ever advances by one (nextVersion = record.version + 1), so this is
   * the same value in the normal path and the correct one in every other.
   */
  const priorVersion = version - 1;

  /*
   * Carry forward inside the database. An INSERT ... SELECT keeps the vectors
   * where they already are instead of pulling every unchanged chunk through Node
   * and re-encoding it, and it runs in the same transaction, so the snapshot is
   * either complete or absent.
   *
   * `row_id` is recomputed from the SAME tuple the insert below uses — with the
   * NEW version in it — because row identity carries the version. Reusing the old
   * row_id would collide with the version it was copied from.
   */
  if (priorVersion > 0) {
    await client.query(
      `INSERT INTO index_chunks
         (row_id, chunk_key, index_id, workspace_id, owner_scope, workspace_scope, file_path, language, symbol,
          start_line, end_line, content_hash, embedding_model, embedding_version, indexed_at, text, vector, index_version)
       SELECT
         encode(sha256(convert_to(
           owner_scope::text || E'\x1f' || workspace_scope::text || E'\x1f' || coalesce(index_id,'')
             || E'\x1f' || $2::bigint::text || E'\x1f' || chunk_key,
           'UTF8')), 'hex'),
         chunk_key, index_id, workspace_id, owner_scope, workspace_scope, file_path, language, symbol,
         start_line, end_line, content_hash, embedding_model, embedding_version, indexed_at, text, vector, $2
       FROM index_chunks
       WHERE index_id = $1 AND index_version = $3 AND file_path <> ALL($4::text[])
       ON CONFLICT (owner_scope, workspace_scope, index_id, index_version, chunk_key) DO NOTHING`,
      [indexId, version, priorVersion, touched],
    );
  }

  for (const c of changed) {
    await client.query(
      /*
       * CONFLICT ON THE CANONICAL TUPLE, never on a bare id.
       *
       * `ON CONFLICT (id)` let one tenant select ANOTHER tenant's row as its
       * conflict target, because the old id was `relPath#startLine` and global.
       * Targeting (owner, workspace, index, index_version, chunk_key) means a
       * conflict can only ever be this index's own chunk, in this scope, AT THIS
       * VERSION.
       *
       * The version is part of the identity because an index legitimately holds
       * the same logical chunk at two versions. Without it, committing v29 takes
       * the v28 row as its conflict target and rewrites it — the new version
       * lands and the old version's content is destroyed. SQLite never had this
       * problem: its row key carried the version too.
       *
       * row_id is derived from that same tuple, so it is stable across re-syncs
       * of an unchanged chunk and cannot collide across scopes or versions.
       */
      `INSERT INTO index_chunks
         (row_id, chunk_key, index_id, workspace_id, owner_scope, workspace_scope, file_path, language, symbol,
          start_line, end_line, content_hash, embedding_model, embedding_version,
          indexed_at, text, vector, index_version)
       VALUES (
         encode(sha256(convert_to(
           $4 || E'\\x1f' || $5 || E'\\x1f' || coalesce($2,'') || E'\\x1f' || $17::bigint::text || E'\\x1f' || $1,
           'UTF8')), 'hex'),
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (owner_scope, workspace_scope, index_id, index_version, chunk_key) DO UPDATE SET
         file_path = EXCLUDED.file_path, language = EXCLUDED.language, symbol = EXCLUDED.symbol,
         start_line = EXCLUDED.start_line, end_line = EXCLUDED.end_line,
         content_hash = EXCLUDED.content_hash, embedding_model = EXCLUDED.embedding_model,
         embedding_version = EXCLUDED.embedding_version, indexed_at = EXCLUDED.indexed_at,
         text = EXCLUDED.text, vector = EXCLUDED.vector, index_version = EXCLUDED.index_version`,
      [
        c.id, indexId, c.workspaceId, scope.ownerScope, scope.workspaceScope, c.filePath, c.language,
        c.symbol ?? null, c.startLine, c.endLine, c.contentHash, c.embeddingModel, c.embeddingVersion,
        c.indexedAt, c.text, toVectorBytes(c.vector, c.id), version,
      ],
    );
  }

  /*
   * `chunk_count` comes from a SUBSELECT, never from `changed.length`.
   *
   * commitSync receives only the CHANGED chunks of an incremental sync, so the
   * caller's array is a delta and using it would undercount every sync after the
   * first. The subselect runs inside this same transaction and under the same
   * scope that just wrote the rows, so it counts exactly what was committed.
   *
   * This number exists to make one specific lie impossible later: an index that
   * fails to restore reports zero chunks, which is indistinguishable from an
   * index that is legitimately empty, and the product then tells the user their
   * real file has "no readable content". Recording the truth at commit time is
   * what lets a reader tell those apart.
   */
  await client.query(
    `INSERT INTO index_versions (index_id, version, owner_scope, workspace_scope, committed_at, chunk_count)
     VALUES ($1,$2,$3,$4,$5,
       (SELECT count(*) FROM index_chunks WHERE index_id = $1 AND index_version = $2))
     ON CONFLICT (index_id, version) DO UPDATE SET
       committed_at = EXCLUDED.committed_at,
       chunk_count  = EXCLUDED.chunk_count`,
    [indexId, version, scope.ownerScope, scope.workspaceScope, updatedAt],
  );

  await client.query(
    'UPDATE workspace_indexes SET version = $2, updated_at = $3 WHERE id = $1',
    [indexId, version, updatedAt],
  );
}

// ── embedding cache (GLOBAL, no RLS — see file header) ──────────────────────

export async function getEmbedding(
  client: PoolClient, model: string, version: string, contentHash: string,
): Promise<number[] | undefined> {
  const { rows } = await client.query<{ vector: Uint8Array; dims: number }>(
    'SELECT vector, dims FROM embedding_cache WHERE model = $1 AND version = $2 AND content_hash = $3',
    [model, version, contentHash],
  );
  const row = rows[0];
  if (!row) return undefined;
  return fromVectorBytes(row.vector, row.dims === null ? undefined : Number(row.dims));
}

export async function putEmbedding(
  client: PoolClient, model: string, version: string, contentHash: string, vector: number[],
): Promise<void> {
  const bytes = toVectorBytes(vector);
  await client.query(
    `INSERT INTO embedding_cache (model, version, content_hash, dims, vector, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (model, version, content_hash) DO UPDATE SET
       dims = EXCLUDED.dims, vector = EXCLUDED.vector, created_at = EXCLUDED.created_at`,
    [model, version, contentHash, vector.length, bytes, Date.now()],
  );
}

export async function pruneOlderThan(client: PoolClient, cutoffMs: number): Promise<number> {
  const result = await client.query('DELETE FROM embedding_cache WHERE created_at < $1', [cutoffMs]);
  return result.rowCount ?? 0;
}

/**
 * How many chunks the committed version RECORDED, independent of how many
 * loaded into memory.
 *
 * Returns null when the version predates M22 (chunk_count IS NULL) or the row is
 * unreadable. Null means "cannot tell" and MUST NOT be read as zero — treating an
 * unknown as an empty index would resurrect the very falsehood this column exists
 * to prevent, just from the opposite direction.
 */
export async function recordedChunkCount(
  client: PoolClient, indexId: string, indexVersion: number,
): Promise<number | null> {
  const { rows } = await client.query<{ chunk_count: string | null }>(
    'SELECT chunk_count FROM index_versions WHERE index_id = $1 AND version = $2',
    [indexId, indexVersion],
  );
  const raw = rows[0]?.chunk_count;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
