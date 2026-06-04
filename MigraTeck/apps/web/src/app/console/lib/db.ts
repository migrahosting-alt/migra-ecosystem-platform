import { Pool, type PoolClient } from "pg";

/**
 * Singleton Postgres pool for the Command Center.
 *
 * Connects to migrapanel DB on db-core over Tailscale. The Command Center is
 * read-only here — any writes happen via panel-api or direct provisioning
 * scripts. This pool exists to power the live dashboard panels.
 *
 * Configure via env on app-core:
 *   MIGRAPANEL_DB_URL=postgresql://reader:PASS@10.10.0.6:5432/migrapanel
 */

let pool: Pool | null = null;

const buildPool = () => {
  const url = process.env.MIGRAPANEL_DB_URL;
  if (!url) {
    return null;
  }
  return new Pool({
    connectionString: url,
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 8_000,
    query_timeout: 8_000,
  });
};

export const getPanelPool = (): Pool | null => {
  if (!pool) pool = buildPool();
  return pool;
};

export type QueryRow = Record<string, unknown>;

export const panelQuery = async <T extends QueryRow = QueryRow>(
  text: string,
  params?: ReadonlyArray<string | number | boolean | null | Date>,
): Promise<T[]> => {
  const p = getPanelPool();
  if (!p) {
    return [];
  }
  let client: PoolClient | null = null;
  try {
    client = await p.connect();
    const res = await client.query<T>(text, params as ReadonlyArray<unknown> as unknown[]);
    return res.rows;
  } catch (err) {
    console.error("[console.db] query failed", {
      sql: text.slice(0, 120),
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  } finally {
    if (client) client.release();
  }
};

export const isPanelDbConfigured = () => Boolean(process.env.MIGRAPANEL_DB_URL);

/**
 * panelExec — write path. Unlike panelQuery, this RETHROWS on error so server
 * actions can catch and redirect with an error message instead of silently
 * succeeding.
 */
export const panelExec = async (
  text: string,
  params?: ReadonlyArray<string | number | boolean | null | Date>,
): Promise<{ rowCount: number }> => {
  const p = getPanelPool();
  if (!p) {
    throw new Error("db_not_configured");
  }
  let client: PoolClient | null = null;
  try {
    client = await p.connect();
    const res = await client.query(text, params as ReadonlyArray<unknown> as unknown[]);
    return { rowCount: res.rowCount ?? 0 };
  } finally {
    if (client) client.release();
  }
};
