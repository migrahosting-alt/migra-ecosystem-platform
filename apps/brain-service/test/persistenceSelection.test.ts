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

test('an UNCONFIGURED Brain refuses to start rather than silently choosing sqlite', () => {
  /*
   * THIS REVERSES ITS OWN EARLIER ASSERTION, which required a bare environment to
   * select sqlite "at the legacy path". Owner ruling: SQLite is not an accepted
   * MigraPilot persistence mode, and a real session must never silently fall back
   * to it when PostgreSQL and governance are unavailable.
   *
   * The silent default was not a harmless convenience. A Brain started with no
   * configuration came up looking healthy — /health ok, chat answering — while
   * the governed qualification routes did not exist at all, because those need
   * the PostgreSQL store. Pointed at such a Brain, the VS Code Extension behaved
   * plausibly right up to the governed paths, and the difference only showed as
   * a 404 where a production Brain returns 200. That reads as "vision is not
   * implemented" rather than "this Brain is not governed", which is the wrong
   * conclusion drawn confidently.
   */
  assert.throws(() => resolvePersistence({}, CWD), PersistenceConfigError);
  assert.throws(
    () => resolvePersistence({ MIGRAPILOT_STATE_DB: '/tmp/x.db' }, CWD),
    PersistenceConfigError,
    'a state-db path is not a request for sqlite — the adapter must be named',
  );
});

test('sqlite is available ONLY when named, and says it is test-only', () => {
  /*
   * The adapter still exists for isolated unit/dev runs — removing it would break
   * every test that needs a store without a database. What changed is that it can
   * no longer be arrived at by accident, and that its own reason string says what
   * it is, so a log line can never again read as a supported deployment.
   */
  const selection = resolvePersistence({ MIGRAPILOT_PERSISTENCE: 'sqlite', MIGRAPILOT_STATE_DB: '/tmp/x.db' }, CWD);
  assert.equal(selection.kind, 'sqlite');
  assert.equal(selection.sqlitePath, '/tmp/x.db');
  assert.match(selection.reason, /TEST-ONLY/, 'the reason must mark it test-only');
  assert.match(selection.reason, /ungoverned|never canonical/, 'and must not read as a supported deployment');
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
  // `{}` left this list when an unconfigured Brain stopped being a SELECTION and
  // became a refusal — it has no reason string to read because it never returns.
  // Its replacement is the named test adapter, which does.
  for (const env of [
    { MIGRAPILOT_PERSISTENCE: 'sqlite' },
    { MIGRAPILOT_STATE_DB: 'off' },
    { MIGRAPILOT_PERSISTENCE: 'postgres', DATABASE_URL: PG },
  ]) {
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
