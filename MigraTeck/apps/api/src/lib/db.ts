import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function connectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is not configured");
  }

  const url = new URL(raw);
  url.searchParams.delete("schema");
  return url.toString();
}

export function getDb(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  const active = pool;
  pool = null;
  if (active) {
    await active.end();
  }
}
