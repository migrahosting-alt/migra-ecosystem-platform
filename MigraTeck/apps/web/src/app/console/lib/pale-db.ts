import { Pool, type PoolClient } from "pg";

/**
 * Read-only Postgres pool for the Pale Control Center.
 *
 * The console SSR (on app-core) reads the Pale database directly for the
 * read-only Phase-1 dashboard. This pool is READ-ONLY by contract — no writes
 * happen here. All future MUTATIONS (ban/suspend/restore/etc.) must go through
 * pale-api's audited `/v1/admin/*` endpoints (RBAC + audit log), never this pool.
 *
 * Configure via env on app-core (use a least-privilege READ-ONLY DB role):
 *   PALE_DATABASE_URL=postgresql://pale_reader:PASS@HOST:5432/pale
 *
 * When unset, isPaleDbConfigured() is false and every panel renders an honest
 * "Not configured" state — the dashboard NEVER fabricates numbers.
 */

let pool: Pool | null = null;

const buildPool = () => {
  const url = process.env.PALE_DATABASE_URL;
  if (!url) return null;
  return new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 8_000,
    query_timeout: 8_000,
    // Defense in depth: force read-only transactions at the session level.
    options: "-c default_transaction_read_only=on",
  });
};

export const getPalePool = (): Pool | null => {
  if (!pool) pool = buildPool();
  return pool;
};

export const isPaleDbConfigured = () => Boolean(process.env.PALE_DATABASE_URL);

export type PaleRow = Record<string, unknown>;

/**
 * Run a read-only query. Returns [] on any error or when the pool is not
 * configured — callers treat [] as "no live data" and render empty/Not-configured
 * states. Never throws into the page render.
 */
export const paleQuery = async <T extends PaleRow = PaleRow>(
  text: string,
  params?: ReadonlyArray<string | number | boolean | null | Date>,
): Promise<T[]> => {
  const p = getPalePool();
  if (!p) return [];
  let client: PoolClient | null = null;
  try {
    client = await p.connect();
    const res = await client.query<T>(
      text,
      params as ReadonlyArray<unknown> as unknown[],
    );
    return res.rows;
  } catch (err) {
    console.error("[pale.db] query failed", {
      sql: text.slice(0, 120),
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  } finally {
    if (client) client.release();
  }
};

/** First-row-first-column number helper; returns null when unavailable. */
export const paleScalar = async (
  text: string,
  params?: ReadonlyArray<string | number | boolean | null | Date>,
): Promise<number | null> => {
  const rows = await paleQuery<{ v: string | number | null }>(text, params);
  const v = rows[0]?.v;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
