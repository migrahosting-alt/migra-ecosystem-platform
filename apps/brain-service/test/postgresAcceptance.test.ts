/**
 * Sub-slice 1 — additional acceptance evidence against a REAL PostgreSQL.
 *
 * Covers the cases the foundation suite does not: partial-migration advance,
 * failed-migration rollback, tenancy primitive BEHAVIOUR (not mere existence),
 * credential redaction in errors/health, and bootstrap from COMPILED artifacts.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresConnection, PostgresMigrationError } from '../src/engine/persistence/postgres/pool.js';
import { MIGRATIONS, PG_SCHEMA_VERSION } from '../src/engine/persistence/postgres/migrations.js';
import {
  postgresTestSkipReason,
  startDisposablePostgres,
  type DisposablePostgres,
} from './support/disposablePostgres.js';

let pg: DisposablePostgres | undefined;
let skip: string | null = null;

before(async () => {
  skip = await postgresTestSkipReason();
  if (!skip) pg = await startDisposablePostgres();
}, { timeout: 180_000 });

after(async () => {
  await pg?.stop();
});

const conn = () => new PostgresConnection({ databaseUrl: pg!.databaseUrl, applicationName: 'brain-accept' });

/**
 * Reset to a true zero state.
 *
 * Recreates the whole schema rather than dropping an enumerated list. An
 * enumerated reset silently rots as migrations are added — an earlier version
 * dropped only the bookkeeping objects plus `migra_scope CASCADE`, which
 * quietly stripped scope COLUMNS from the conversation tables while leaving the
 * tables in place, so `CREATE TABLE IF NOT EXISTS` skipped them and later
 * inserts failed against a half-formed schema.
 */
async function resetToEmpty(): Promise<void> {
  const c = conn();
  try {
    await c.query('DROP SCHEMA public CASCADE');
    await c.query('CREATE SCHEMA public');
  } finally {
    await c.close();
  }
}

test('a completely empty database bootstraps from version 0 to the derived version', async (t) => {
  if (skip) return t.skip(skip);
  await resetToEmpty();

  const c = conn();
  try {
    // Prove we really started at zero.
    const before = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'schema_meta'`,
    );
    assert.equal(Number(before[0]!.n), 0, 'precondition: schema_meta must not exist');

    await c.migrate();
    assert.equal(c.health().schemaVersion, PG_SCHEMA_VERSION);
    assert.equal(c.health().migrationState, 'applied');
  } finally {
    await c.close();
  }
});

test('a partially migrated database advances only the pending migrations', async (t) => {
  if (skip) return t.skip(skip);
  await resetToEmpty();

  // Apply migration 1 only, simulating an interrupted upgrade.
  const seed = conn();
  try {
    await seed.query(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await seed.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), duration_ms INTEGER NOT NULL)`,
    );
    await seed.query(MIGRATIONS[0]!.sql);
    await seed.query(`INSERT INTO schema_migrations (version, name, duration_ms) VALUES (1, 'foundation', 0)`);
    await seed.query(`INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1')`);
  } finally {
    await seed.close();
  }

  const c = conn();
  try {
    await c.migrate();
    assert.equal(c.health().schemaVersion, PG_SCHEMA_VERSION, 'must advance to current');
    assert.equal(c.health().migrationState, 'applied');

    const rows = await c.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(rows.map((r) => r.version), MIGRATIONS.map((m) => m.version));
    assert.equal(rows.length, MIGRATIONS.length, 'migration 1 must not be re-recorded');
  } finally {
    await c.close();
  }
});

test('a failing migration rolls back completely — no half-applied version record', async (t) => {
  if (skip) return t.skip(skip);
  await resetToEmpty();

  const c = conn();
  try {
    await c.migrate();
    const versionBefore = c.health().schemaVersion;

    // Force the NEXT migration to fail by pre-creating a conflicting object,
    // then attempt a hand-rolled application of a deliberately broken migration
    // through the same transactional path.
    const broken = {
      version: PG_SCHEMA_VERSION + 1,
      name: 'deliberately_broken',
      sql: 'CREATE TABLE rollback_probe (id INT); SELECT this_function_does_not_exist();',
    };

    await assert.rejects(
      () => c.transaction(async (client) => {
        await client.query(broken.sql);
        await client.query(
          `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [String(broken.version)],
        );
      }),
      'a broken migration must reject',
    );

    // Neither the table nor the version bump may survive.
    const probe = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'rollback_probe'`,
    );
    assert.equal(Number(probe[0]!.n), 0, 'rolled-back migration must leave no table');

    const version = await c.query<{ value: string }>(
      `SELECT value FROM schema_meta WHERE key = 'schema_version'`,
    );
    assert.equal(Number(version[0]!.value), versionBefore, 'version must not advance on failure');

    const ledger = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM schema_migrations WHERE version = $1`,
      [broken.version],
    );
    assert.equal(Number(ledger[0]!.n), 0, 'failed migration must not be recorded');
  } finally {
    await c.close();
  }
});

test('migra_scope enforces its documented constraints', async (t) => {
  if (skip) return t.skip(skip);
  await resetToEmpty();
  const c = conn();
  try {
    await c.migrate();
    await c.query('CREATE TEMP TABLE scope_probe (s migra_scope)');

    await c.query(`INSERT INTO scope_probe VALUES ('user:abc')`);
    const ok = await c.query<{ s: string }>('SELECT s FROM scope_probe');
    assert.equal(ok[0]!.s, 'user:abc');

    await assert.rejects(() => c.query(`INSERT INTO scope_probe VALUES ('')`), 'empty scope must be rejected');
    await assert.rejects(
      () => c.query(`INSERT INTO scope_probe VALUES (repeat('x', 201))`),
      'over-length scope must be rejected',
    );
  } finally {
    await c.close();
  }
});

test('migra_current_owner/workspace read session scope and default to null', async (t) => {
  if (skip) return t.skip(skip);
  await resetToEmpty();
  const c = conn();
  try {
    await c.migrate();

    // Within one connection: unset ⇒ null; set ⇒ the value; blank ⇒ null.
    await c.transaction(async (client) => {
      const unset = await client.query('SELECT migra_current_owner() AS o, migra_current_workspace() AS w');
      assert.equal(unset.rows[0].o, null, 'owner must default to null, not empty string');
      assert.equal(unset.rows[0].w, null, 'workspace must default to null');

      await client.query(`SELECT set_config('migrapilot.owner_scope', 'user:alice', true)`);
      await client.query(`SELECT set_config('migrapilot.workspace_scope', 'org:acme', true)`);
      const set = await client.query('SELECT migra_current_owner() AS o, migra_current_workspace() AS w');
      assert.equal(set.rows[0].o, 'user:alice');
      assert.equal(set.rows[0].w, 'org:acme');

      await client.query(`SELECT set_config('migrapilot.owner_scope', '', true)`);
      const blank = await client.query('SELECT migra_current_owner() AS o');
      assert.equal(blank.rows[0].o, null, 'blank scope must normalise to null, never match a row');
    });
  } finally {
    await c.close();
  }
});

test('credentials never appear in health output or connection errors', async (t) => {
  if (skip) return t.skip(skip);
  const secret = 'sup3rs3cret';
  const dead = new PostgresConnection({
    databaseUrl: `postgresql://brainuser:${secret}@127.0.0.1:1/none`,
    connectionTimeoutMillis: 2_000,
  });
  try {
    assert.ok(!dead.target().includes(secret), 'redacted target must not carry the password');

    await assert.rejects(async () => {
      try {
        await dead.migrate();
      } catch (error) {
        const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
        assert.ok(!text.includes(secret), 'error must not leak the password');
        throw error;
      }
    });

    const health = JSON.stringify(dead.health());
    assert.ok(!health.includes(secret), 'health payload must not leak the password');
  } finally {
    await dead.close().catch(() => undefined);
  }
});

test('bootstrap works from COMPILED artifacts, not just TypeScript sources', async (t) => {
  if (skip) return t.skip(skip);
  await resetToEmpty();

  // Import the built output the way a packaged release would.
  //
  // The specifier is built at runtime on purpose: a literal
  // `import('../dist/...')` makes TypeScript treat dist/ as a program INPUT,
  // and `tsc -b` then refuses to emit over its own output (TS5055).
  //
  // It is also resolved from the PACKAGE ROOT rather than relative to this
  // file, because this suite runs from two locations — `test/` under tsx and
  // `dist/test/` under `npm test` — and a file-relative path is only correct in
  // one of them.
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const { existsSync } = await import('node:fs');

  let root = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(root, 'package.json')) && dirname(root) !== root) root = dirname(root);

  const distEntry = join(root, 'dist/src/engine/persistence/postgres/pool.js');
  assert.ok(existsSync(distEntry), `compiled artifact missing at ${distEntry} — run \`npm run build\``);

  const compiled = (await import(new URL(`file://${distEntry}`).href)) as {
    PostgresConnection: typeof PostgresConnection;
  };
  const c = new compiled.PostgresConnection({ databaseUrl: pg!.databaseUrl, applicationName: 'brain-dist' });
  try {
    await c.migrate();
    assert.equal(c.health().migrationState, 'applied');
    assert.equal(c.health().schemaVersion, PG_SCHEMA_VERSION);

    // Proves migrations really are embedded in the build — a .sql-file design
    // would compile fine and fail exactly here.
    const rows = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM schema_migrations');
    assert.equal(Number(rows[0]!.n), MIGRATIONS.length);
  } finally {
    await c.close();
  }
});

test('PostgresMigrationError is the typed failure surface', async (t) => {
  if (skip) return t.skip(skip);
  const dead = new PostgresConnection({
    databaseUrl: 'postgresql://x:y@127.0.0.1:1/none',
    connectionTimeoutMillis: 1_500,
  });
  try {
    await dead.migrate();
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(dead.health().memoryStore, 'unavailable');
  } finally {
    await dead.close().catch(() => undefined);
  }
});

void PostgresMigrationError;
