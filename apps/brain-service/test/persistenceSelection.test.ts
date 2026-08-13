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
