/**
 * Sub-slice 1 — persistence selection.
 *
 * The property under test is refusal: production must never reach a local
 * SQLite database, by any configuration path. These are pure unit tests; the
 * real-PostgreSQL behaviour lives in postgresFoundation.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PersistenceConfigError,
  redactDatabaseUrl,
  resolvePersistence,
  type PersistenceEnv,
} from '../src/engine/persistence/persistenceConfig.js';

const CWD = '/srv/app';
const PG = 'postgresql://user:secret@db.internal:5432/brain';

const prod = (extra: PersistenceEnv = {}): PersistenceEnv => ({ NODE_ENV: 'production', ...extra });

// ── production refuses every route to SQLite ────────────────────────────────

test('production without DATABASE_URL refuses to start', () => {
  assert.throws(() => resolvePersistence(prod(), CWD), PersistenceConfigError);
});

test('production explicitly selecting sqlite refuses', () => {
  assert.throws(
    () => resolvePersistence(prod({ MIGRAPILOT_PERSISTENCE: 'sqlite', DATABASE_URL: PG }), CWD),
    PersistenceConfigError,
  );
});

test('production with MIGRAPILOT_STATE_DB set refuses', () => {
  assert.throws(
    () => resolvePersistence(prod({ DATABASE_URL: PG, MIGRAPILOT_STATE_DB: '/var/lib/x.db' }), CWD),
    PersistenceConfigError,
  );
});

test('production cannot disable durable persistence', () => {
  assert.throws(() => resolvePersistence(prod({ MIGRAPILOT_STATE_DB: 'off' }), CWD), PersistenceConfigError);
});

test('production rejects a non-postgres DATABASE_URL', () => {
  assert.throws(
    () => resolvePersistence(prod({ DATABASE_URL: 'mysql://h/db' }), CWD),
    PersistenceConfigError,
  );
});

test('production with a valid DATABASE_URL selects postgres', () => {
  const selection = resolvePersistence(prod({ DATABASE_URL: PG }), CWD);
  assert.equal(selection.kind, 'postgres');
  assert.equal(selection.databaseUrl, PG);
  assert.equal(selection.sqlitePath, undefined);
});

// ── no silent fallback outside production either ────────────────────────────

test('explicit postgres without DATABASE_URL refuses rather than falling back', () => {
  assert.throws(
    () => resolvePersistence({ MIGRAPILOT_PERSISTENCE: 'postgres' }, CWD),
    PersistenceConfigError,
  );
});

test('an unknown persistence kind is rejected, not defaulted', () => {
  assert.throws(() => resolvePersistence({ MIGRAPILOT_PERSISTENCE: 'mongo' }, CWD), PersistenceConfigError);
});

// ── local/dev/test behaviour is preserved ───────────────────────────────────

test('default outside production stays sqlite at the legacy path', () => {
  const selection = resolvePersistence({}, CWD);
  assert.equal(selection.kind, 'sqlite');
  assert.equal(selection.sqlitePath, '/srv/app/migraai-state.db');
});

test('MIGRAPILOT_STATE_DB still selects an explicit sqlite path', () => {
  const selection = resolvePersistence({ MIGRAPILOT_STATE_DB: '/tmp/x.db' }, CWD);
  assert.equal(selection.kind, 'sqlite');
  assert.equal(selection.sqlitePath, '/tmp/x.db');
});

test('MIGRAPILOT_STATE_DB=off remains supported outside production', () => {
  assert.equal(resolvePersistence({ MIGRAPILOT_STATE_DB: 'off' }, CWD).kind, 'off');
});

test('dev may opt into postgres', () => {
  const selection = resolvePersistence({ MIGRAPILOT_PERSISTENCE: 'postgres', DATABASE_URL: PG }, CWD);
  assert.equal(selection.kind, 'postgres');
});

// ── credentials never leak ──────────────────────────────────────────────────

test('database url redaction removes credentials', () => {
  const redacted = redactDatabaseUrl(PG);
  assert.ok(!redacted.includes('secret'), 'password must not survive redaction');
  assert.ok(!redacted.includes('user:'), 'username must not survive redaction');
  assert.ok(redacted.includes('db.internal'), 'host should remain for diagnosis');
});

test('every selection reason is human-readable and non-empty', () => {
  for (const env of [{}, { MIGRAPILOT_STATE_DB: 'off' }, { MIGRAPILOT_PERSISTENCE: 'postgres', DATABASE_URL: PG }]) {
    const selection = resolvePersistence(env as PersistenceEnv, CWD);
    assert.ok(selection.reason.length > 10, `reason too terse: ${selection.reason}`);
    assert.ok(!selection.reason.includes('secret'), 'reason must not carry credentials');
  }
});

// ── the contradiction that aborted a production cutover ─────────────────────

/*
 * `MIGRAPILOT_PERSISTENCE=postgres` selects PostgreSQL.
 * `MIGRAPILOT_STATE_DB=off` disables durable persistence entirely.
 *
 * Set together, the `off` branch ran first: the Brain came up with persistence
 * `off`, reported `status: ok` with `persistence: unavailable`, and never
 * consulted PostgreSQL. Outside production that branch does not even throw, so
 * the contradiction degraded silently into a Brain that looks healthy and
 * refuses every durable write.
 */

test('postgres + MIGRAPILOT_STATE_DB=off is a hard startup failure, not a silent downgrade', () => {
  assert.throws(
    () => resolvePersistence(
      { MIGRAPILOT_PERSISTENCE: 'postgres', MIGRAPILOT_STATE_DB: 'off', MIGRAPILOT_BRAIN_DATABASE_URL: PG }, CWD,
    ),
    (error: unknown) => error instanceof PersistenceConfigError && /contradict/i.test((error as Error).message),
    'the engine must refuse rather than pick one of two incompatible instructions',
  );
});

test('it fails the same way in production', () => {
  assert.throws(
    () => resolvePersistence(
      prod({ MIGRAPILOT_PERSISTENCE: 'postgres', MIGRAPILOT_STATE_DB: 'off', MIGRAPILOT_BRAIN_DATABASE_URL: PG }), CWD,
    ),
    (error: unknown) => error instanceof PersistenceConfigError && /contradict/i.test((error as Error).message),
  );
});

test('postgres + EMPTY MIGRAPILOT_STATE_DB selects PostgreSQL', () => {
  // Empty is how an inherited value is cleared — the documented way to stop
  // SQLite being used without claiming "no durability".
  const selection = resolvePersistence(
    { MIGRAPILOT_PERSISTENCE: 'postgres', MIGRAPILOT_STATE_DB: '', MIGRAPILOT_BRAIN_DATABASE_URL: PG }, CWD,
  );
  assert.equal(selection.kind, 'postgres');
  assert.equal(selection.databaseUrl, PG);
});

test('postgres with MIGRAPILOT_STATE_DB absent entirely selects PostgreSQL', () => {
  const selection = resolvePersistence(
    { MIGRAPILOT_PERSISTENCE: 'postgres', MIGRAPILOT_BRAIN_DATABASE_URL: PG }, CWD,
  );
  assert.equal(selection.kind, 'postgres');
});

test('postgres wins even when a legacy SQLite PATH is still set — no fallback', () => {
  /*
   * The realistic production shape: brain.env still carries the old
   * MIGRAPILOT_STATE_DB pointing at brain-state.db. That must not drag the
   * engine back to SQLite, and must not be treated as a contradiction either —
   * a stale path is not the `off` switch.
   */
  const selection = resolvePersistence(
    {
      MIGRAPILOT_PERSISTENCE: 'postgres',
      MIGRAPILOT_STATE_DB: '/var/lib/migrapilot/brain-state.db',
      MIGRAPILOT_BRAIN_DATABASE_URL: PG,
    },
    CWD,
  );
  assert.equal(selection.kind, 'postgres', 'a leftover SQLite path must not win over an explicit postgres selection');
  assert.equal((selection as { sqlitePath?: string }).sqlitePath, undefined, 'and no SQLite path is carried forward');
});

test('production still refuses a legacy SQLite path even with postgres requested', () => {
  // Unchanged contract: in production a set MIGRAPILOT_STATE_DB is an error,
  // because it means someone believes a local file is still involved.
  assert.throws(
    () => resolvePersistence(
      prod({
        MIGRAPILOT_PERSISTENCE: 'postgres',
        MIGRAPILOT_STATE_DB: '/var/lib/migrapilot/brain-state.db',
        MIGRAPILOT_BRAIN_DATABASE_URL: PG,
      }),
      CWD,
    ),
    PersistenceConfigError,
  );
});

test('the local off switch still works when postgres is NOT requested', () => {
  // The explicit local contract is untouched until SQLite support is removed.
  const selection = resolvePersistence({ MIGRAPILOT_STATE_DB: 'off' }, CWD);
  assert.equal(selection.kind, 'off');
});

test('sqlite + off still resolves to off, not to a contradiction', () => {
  // Only postgres conflicts with `off`. `sqlite` + `off` is a coherent local
  // instruction — "the SQLite adapter, with durability disabled" — and widening
  // the guard to cover it would break the existing dev contract.
  const selection = resolvePersistence({ MIGRAPILOT_PERSISTENCE: 'sqlite', MIGRAPILOT_STATE_DB: 'off' }, CWD);
  assert.equal(selection.kind, 'off');
});
