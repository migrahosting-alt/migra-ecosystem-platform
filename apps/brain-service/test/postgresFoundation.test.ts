/**
 * Sub-slice 1 — PostgreSQL foundation, against a REAL PostgreSQL.
 *
 * Migration ordering, advisory locking and version mismatch cannot be validated
 * against a mock, so these tests spawn a disposable container. If no real
 * database is available the suite SKIPS with a stated reason — it never passes
 * vacuously, because a green run on zero executed assertions is the failure
 * mode this whole slice exists to avoid.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresConnection, PostgresMigrationError } from '../src/engine/persistence/postgres/pool.js';
import { MIGRATIONS, PG_SCHEMA_VERSION, latestVersion } from '../src/engine/persistence/postgres/migrations.js';
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

function connection(): PostgresConnection {
  return new PostgresConnection({ databaseUrl: pg!.databaseUrl, applicationName: 'brain-test' });
}

// ── migration definition invariants (no database required) ──────────────────

test('migration versions are unique, ordered and gapless from 1', () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), 'migrations must be ordered');
  assert.equal(new Set(versions).size, versions.length, 'versions must be unique');
  versions.forEach((v, i) => assert.equal(v, i + 1, 'versions must be gapless starting at 1'));
});

test('PG_SCHEMA_VERSION is derived, not hand-maintained', () => {
  assert.equal(PG_SCHEMA_VERSION, latestVersion());
});

// ── real PostgreSQL ─────────────────────────────────────────────────────────

test('migrations apply cleanly to an empty database', async (t) => {
  if (skip) return t.skip(skip);
  const conn = connection();
  try {
    await conn.migrate();
    const health = conn.health();
    assert.equal(health.migrationState, 'applied');
    assert.equal(health.schemaVersion, PG_SCHEMA_VERSION);
    assert.equal(health.memoryStore, 'ready');
  } finally {
    await conn.close();
  }
});

test('re-running migrations is idempotent and reports current', async (t) => {
  if (skip) return t.skip(skip);
  const conn = connection();
  try {
    await conn.migrate();
    const health = conn.health();
    assert.equal(health.migrationState, 'current', 'second run must apply nothing');
    assert.equal(health.schemaVersion, PG_SCHEMA_VERSION);
  } finally {
    await conn.close();
  }
});

test('every migration is recorded in the ledger exactly once', async (t) => {
  if (skip) return t.skip(skip);
  const conn = connection();
  try {
    await conn.migrate();
    const rows = await conn.query<{ version: number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version',
    );
    assert.equal(rows.length, MIGRATIONS.length);
    assert.deepEqual(rows.map((r) => r.version), MIGRATIONS.map((m) => m.version));
  } finally {
    await conn.close();
  }
});

test('concurrent migrators serialise on the advisory lock without error', async (t) => {
  if (skip) return t.skip(skip);
  const conns = [connection(), connection(), connection()];
  try {
    // A rolling restart starts several engines at once; none may corrupt the
    // ledger or double-apply.
    await Promise.all(conns.map((c) => c.migrate()));
    const rows = await conns[0]!.query<{ n: string }>('SELECT count(*)::text AS n FROM schema_migrations');
    assert.equal(Number(rows[0]!.n), MIGRATIONS.length, 'no migration may be recorded twice');
  } finally {
    await Promise.all(conns.map((c) => c.close()));
  }
});

test('a database newer than the engine is a hard mismatch, not a downgrade', async (t) => {
  if (skip) return t.skip(skip);
  const conn = connection();
  try {
    await conn.migrate();
    await conn.query(
      `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(PG_SCHEMA_VERSION + 5)],
    );

    const fresh = connection();
    try {
      await assert.rejects(() => fresh.migrate(), PostgresMigrationError);
      const health = fresh.health();
      assert.equal(health.migrationState, 'mismatch');
      assert.equal(health.memoryStore, 'unavailable', 'a mismatched schema must not report ready');
    } finally {
      await fresh.close();
    }
  } finally {
    // Restore so later tests see a consistent database.
    const repair = connection();
    await repair.query(
      `UPDATE schema_meta SET value = $1 WHERE key = 'schema_version'`,
      [String(PG_SCHEMA_VERSION)],
    ).catch(() => undefined);
    await repair.close();
    await conn.close();
  }
});

test('readiness is not liveness: ping succeeds before migrate, health is not ready', async (t) => {
  if (skip) return t.skip(skip);
  const conn = connection();
  try {
    assert.equal(await conn.ping(), true, 'database is reachable');
    const health = conn.health();
    assert.equal(health.migrationState, 'pending');
    assert.equal(health.memoryStore, 'unavailable', 'reachable != ready');
  } finally {
    await conn.close();
  }
});

test('an unreachable database fails closed rather than hanging', async (t) => {
  if (skip) return t.skip(skip);
  const dead = new PostgresConnection({
    databaseUrl: 'postgresql://postgres:nope@127.0.0.1:1/none',
    connectionTimeoutMillis: 2_000,
    applicationName: 'brain-test-dead',
  });
  try {
    assert.equal(await dead.ping(), false);
    await assert.rejects(() => dead.migrate());
    assert.equal(dead.health().memoryStore, 'unavailable');
  } finally {
    await dead.close().catch(() => undefined);
  }
});

test('tenancy primitives exist after migration', async (t) => {
  if (skip) return t.skip(skip);
  const conn = connection();
  try {
    await conn.migrate();
    const fns = await conn.query<{ proname: string }>(
      `SELECT proname FROM pg_proc WHERE proname IN ('migra_current_owner','migra_current_workspace')`,
    );
    assert.equal(fns.length, 2, 'scope accessor functions must exist for RLS in sub-slice 2');

    const domain = await conn.query<{ typname: string }>(
      `SELECT typname FROM pg_type WHERE typname = 'migra_scope'`,
    );
    assert.equal(domain.length, 1, 'migra_scope domain must exist');
  } finally {
    await conn.close();
  }
});
