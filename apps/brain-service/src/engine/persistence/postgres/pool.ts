/**
 * MigraAI Engine — PostgreSQL connection and migration runner.
 *
 * Sub-slice 1 scope: connect, migrate, report readiness. The durable store's
 * data methods arrive in sub-slice 2 — this module deliberately owns no domain
 * behaviour, so the connection/migration contract can be reviewed on its own.
 *
 * Two properties are enforced here rather than left to callers:
 *
 *   MIGRATIONS ARE SERIALISED ACROSS PROCESSES. Two engines starting at once
 *   must not run the same migration concurrently, so the runner takes a
 *   PostgreSQL advisory lock. Without it, a rolling restart is a race.
 *
 *   READINESS IS NOT LIVENESS. A reachable database whose schema is older than
 *   the engine is NOT ready, and a database newer than the engine is a hard
 *   mismatch — the engine refuses rather than writing rows it cannot model.
 */

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { MIGRATIONS, PG_SCHEMA_VERSION, type Migration } from './migrations.js';
import { redactDatabaseUrl } from '../persistenceConfig.js';
import type { PersistenceHealth } from '../types.js';

/** Namespaced advisory-lock key. Arbitrary but must stay stable across releases. */
const MIGRATION_LOCK_KEY = 0x4d47_5031; // "MGP1"

export interface PostgresConnectionOptions {
  databaseUrl: string;
  /** Bounded so a stalled database surfaces as an error, not a hung boot. */
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  max?: number;
  applicationName?: string;
}

export class PostgresMigrationError extends Error {
  readonly code = 'PG_MIGRATION';
  constructor(message: string) {
    super(message);
    this.name = 'PostgresMigrationError';
  }
}

export class PostgresConnection {
  private readonly pool: Pool;
  private appliedVersion = 0;
  private state: PersistenceHealth['migrationState'] = 'pending';
  private detail: string | undefined;

  constructor(private readonly options: PostgresConnectionOptions) {
    const config: PoolConfig = {
      connectionString: options.databaseUrl,
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
      max: options.max ?? 10,
      application_name: options.applicationName ?? 'migrapilot-brain',
    };
    this.pool = new Pool(config);

    // A pool-level error must not take the process down; it is reported through
    // health instead, matching how the SQLite adapter degrades rather than exits.
    this.pool.on('error', (error) => {
      this.state = 'failed';
      this.detail = error.message;
    });

    const statementTimeout = options.statementTimeoutMillis ?? 30_000;
    this.pool.on('connect', (client) => {
      void client.query(`SET statement_timeout = ${Number(statementTimeout)}`).catch(() => undefined);
    });
  }

  /** Redacted connection target, safe for logs and /health. */
  target(): string {
    return redactDatabaseUrl(this.options.databaseUrl);
  }

  async query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(text, params as never[]);
    return result.rows as T[];
  }

  /** Run `fn` inside a transaction; rolls back on any throw. */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Apply pending migrations and establish readiness.
   *
   * Throws on an unrecoverable condition — a caller in production is expected to
   * let that abort startup rather than continue with unknown schema state.
   */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      try {
        await this.ensureBookkeeping(client);
        const current = await this.readVersion(client);

        if (current > PG_SCHEMA_VERSION) {
          this.state = 'mismatch';
          this.appliedVersion = current;
          this.detail = `database schema v${current} is newer than engine v${PG_SCHEMA_VERSION}`;
          throw new PostgresMigrationError(this.detail);
        }

        const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
        for (const migration of pending) {
          await this.applyOne(client, migration);
        }

        this.appliedVersion = await this.readVersion(client);
        this.state = pending.length === 0 ? 'current' : 'applied';
        this.detail = undefined;
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
      }
    } catch (error) {
      if (this.state !== 'mismatch') {
        this.state = 'failed';
        this.detail = error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureBookkeeping(client: PoolClient): Promise<void> {
    // Only the bookkeeping tables are created outside a migration — they are
    // what makes migrations recordable in the first place.
    await client.query(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         duration_ms INTEGER NOT NULL)`,
    );
  }

  private async readVersion(client: PoolClient): Promise<number> {
    const rows = await client.query<{ value: string }>(
      `SELECT value FROM schema_meta WHERE key = 'schema_version'`,
    );
    const raw = rows.rows[0]?.value;
    const parsed = raw === undefined ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async applyOne(client: PoolClient, migration: Migration): Promise<void> {
    const started = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      const duration = Date.now() - started;
      await client.query(
        `INSERT INTO schema_migrations (version, name, duration_ms) VALUES ($1, $2, $3)
         ON CONFLICT (version) DO NOTHING`,
        [migration.version, migration.name, duration],
      );
      await client.query(
        `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(migration.version)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new PostgresMigrationError(
        `migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Assert this connection cannot bypass row level security.
   *
   * PostgreSQL superusers and BYPASSRLS roles ignore RLS entirely — policies
   * remain visible and correct in the catalogue while enforcing nothing. Tenant
   * isolation would be silently absent, which is the most dangerous possible
   * failure mode: it looks configured.
   *
   * Returns the offending reason, or null when the connection is safe.
   */
  async rlsBypassRisk(): Promise<string | null> {
    const rows = await this.query<{ usr: string; is_super: boolean; bypass: boolean }>(
      `SELECT current_user AS usr,
              COALESCE((SELECT rolsuper   FROM pg_roles WHERE rolname = current_user), false) AS is_super,
              COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass`,
    );
    const row = rows[0];
    if (!row) return 'could not determine the current role';
    if (row.is_super) return `connected as SUPERUSER '${row.usr}' — row level security is bypassed entirely`;
    if (row.bypass) return `role '${row.usr}' has BYPASSRLS — row level security is bypassed entirely`;
    return null;
  }

  /** Cheap reachability probe. Distinguishes "process alive" from "db reachable". */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      this.detail = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  health(): PersistenceHealth {
    const ready = this.state === 'current' || this.state === 'applied';
    return {
      memoryStore: ready ? 'ready' : 'unavailable',
      ragStore: ready ? 'ready' : 'unavailable',
      schemaVersion: this.appliedVersion,
      migrationState: this.state,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
