// MigraPilot — Postgres + pgvector MemoryStorage (Phase 9.4). DORMANT by default.
// Enabled only when PILOT_MEMORY_BACKEND=pgvector AND DATABASE_URL are set. The `pg`
// package is imported LAZILY via a non-literal specifier so dev/build never require it.
// If pg is missing / DB is unreachable / the extension or tables are absent, init() throws
// and the dispatcher falls back to file-backed memory.
//
// Schema: see migrations/0001_pilot_pgvector.sql. Verified Phase 10.0 against dev PG16 + pgvector 0.6.
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Chunk, Embedding, MemoryStorage, SearchHit, Source } from "./types";

let pool: any = null;
let ready = false;

async function getPool(): Promise<any> {
  if (pool) return pool;
  const spec = "pg"; // non-literal specifier: not resolved at type-check/bundle time
  let pg: any;
  try {
    pg = await import(spec);
  } catch {
    throw new Error("the 'pg' package is not installed (enable pgvector with: npm install pg)");
  }
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (!Pool) throw new Error("invalid 'pg' module: no Pool export");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

// pgvector text input format, e.g. "[0.1,0.2,...]"
function toVector(v: number[]): string {
  return `[${v.join(",")}]`;
}

export const pgStorage: MemoryStorage = {
  async init() {
    if (ready) return;
    const p = await getPool();
    const ext = await p.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
    if (ext.rowCount === 0) throw new Error("pgvector extension not installed (run migrations/0001_pilot_pgvector.sql)");
    const tbl = await p.query("SELECT to_regclass('public.pilot_embeddings') AS t");
    if (!tbl.rows?.[0]?.t) throw new Error("pilot_* tables missing (run migrations/0001_pilot_pgvector.sql)");
    ready = true;
  },

  async getStats() {
    const p = await getPool();
    const r = await p.query(
      "SELECT (SELECT count(*) FROM pilot_sources)::int AS sources, (SELECT count(*) FROM pilot_chunks)::int AS chunks, (SELECT max(created_at) FROM pilot_sources) AS last",
    );
    const row = r.rows[0] ?? {};
    return { sourceCount: row.sources ?? 0, chunkCount: row.chunks ?? 0, lastIngest: row.last ? new Date(row.last).toISOString() : null };
  },

  async listSources(): Promise<Source[]> {
    const p = await getPool();
    const r = await p.query("SELECT id, path, title, hash, bytes, chunk_count, created_at FROM pilot_sources ORDER BY created_at DESC");
    return r.rows.map((row: any) => ({
      id: row.id,
      path: row.path,
      title: row.title,
      hash: row.hash,
      bytes: Number(row.bytes),
      chunkCount: Number(row.chunk_count),
      createdAt: new Date(row.created_at).toISOString(),
    } satisfies Source));
  },

  // Reingest-safe: delete the prior source for this path (cascade clears its chunks+embeddings), then insert — in one transaction.
  async replaceSource(source: Source, chunks: Chunk[], embeddings: Embedding[]) {
    const p = await getPool();
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM pilot_sources WHERE path = $1", [source.path]);
      await client.query(
        "INSERT INTO pilot_sources (id, path, title, hash, bytes, chunk_count, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [source.id, source.path, source.title, source.hash, source.bytes, source.chunkCount, source.createdAt],
      );
      const vecByChunk = new Map(embeddings.map((e) => [e.chunkId, e.vector]));
      for (const c of chunks) {
        await client.query("INSERT INTO pilot_chunks (id, source_id, idx, text) VALUES ($1,$2,$3,$4)", [c.id, c.sourceId, c.index, c.text]);
        const vec = vecByChunk.get(c.id);
        if (vec) await client.query("INSERT INTO pilot_embeddings (chunk_id, embedding) VALUES ($1,$2)", [c.id, toVector(vec)]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async flush() {
    // pg commits per replaceSource transaction — nothing to flush.
  },

  // Memory-only delete by path; the ON DELETE CASCADE removes chunks + embeddings. Never touches files.
  async deleteSourceByPath(path: string): Promise<boolean> {
    const p = await getPool();
    const r = await p.query("DELETE FROM pilot_sources WHERE path = $1", [path]);
    return (r.rowCount ?? 0) > 0;
  },

  async searchVectors(qv: number[], k: number): Promise<SearchHit[]> {
    const p = await getPool();
    const limit = Math.max(1, Math.min(k, 20));
    // ivfflat defaults to probes=1, which silently misses on small or list-misaligned data
    // (a query vector can land in a different list than the only matching doc). Probe all lists
    // — pgvector caps probes at `lists`, so this yields EXACT recall, correctness over raw speed
    // at MigraPilot's memory scale. For very large corpora, prefer an HNSW index (see
    // migrations/0001_pilot_pgvector.sql). SET LOCAL requires an explicit transaction.
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ivfflat.probes = 1000");
      const r = await client.query(
        `SELECT c.id AS chunk_id, c.source_id, s.title, s.path, c.text,
                1 - (e.embedding <=> $1) AS score
           FROM pilot_embeddings e
           JOIN pilot_chunks c ON c.id = e.chunk_id
           JOIN pilot_sources s ON s.id = c.source_id
          ORDER BY e.embedding <=> $1 ASC
          LIMIT $2`,
        [toVector(qv), limit],
      );
      await client.query("COMMIT");
      return r.rows.map((row: any) => ({
        chunkId: row.chunk_id,
        sourceId: row.source_id,
        title: row.title,
        path: row.path,
        score: Number(row.score),
        snippet: String(row.text).replace(/\s+/g, " ").slice(0, 300),
      } satisfies SearchHit));
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  },
};
