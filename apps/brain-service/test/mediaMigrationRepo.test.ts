/**
 * The migration ledger, in the database that outlives the bucket.
 *
 * WHY IT MOVED HERE. The first version lived in the destination bucket, so
 * losing that bucket would have lost the artifact AND the record of where the
 * artifact went — the evidence sharing the fate of the thing it is evidence
 * about. The object-side copy stays as mirrored evidence; this is the authority.
 *
 * Run against a REAL PostgreSQL, because the properties being asserted are the
 * unique constraint and durability across processes, and a fake client would
 * prove neither.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import {
  getMediaMigration, isMediaMigrationVerified, listUnverifiedMediaMigrations,
  migrationId, recordMediaMigration, summariseMediaMigrations,
} from '../src/engine/persistence/postgres/mediaMigrationRepo.js';
import {
  postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let connection: PostgresConnection;

const DEST = 'minio:migrapilot-artifacts';
const SCOPE_A = 'e19a79f108eb0cbdb93cb88b909719ef';
const SCOPE_B = '0483ddbda16bf778ebd00cc497027d8c';
/* The real case that made scope part of the key: one content-addressed id, two owners. */
const SHARED_ID = 'img_c3df4007f7a5364cedeecf517c6490d8';
const HASH = 'c3df4007f7a5364cedeecf517c6490d801a959484da038ac345d3c4bd24b2f92';

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
  connection = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await connection.migrate();
});

after(async () => {
  await connection?.close().catch(() => undefined);
  await pg?.stop().catch(() => undefined);
});

/** The connection's own transaction helper — the pool is deliberately private. */
const withClient = <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> => connection.transaction(fn);

const entry = (scope: string, overrides: Record<string, unknown> = {}) => ({
  scope,
  artifactId: SHARED_ID,
  sourceProvider: 'local-filesystem',
  sourceKey: `${scope}/${SHARED_ID}.png`,
  destinationProvider: DEST,
  destinationKey: `${scope}/${SHARED_ID}.png`,
  expectedHash: HASH,
  status: 'verified' as const,
  verifiedHash: HASH,
  verifiedAt: 1_700_000_000_000,
  copiedAt: 1_700_000_000_000,
  at: 1_700_000_000_000,
  ...overrides,
});

test('a verified migration survives into a fresh read', async (t) => {
  if (skip) return t.skip(skip);
  await withClient((c) => recordMediaMigration(c, entry(SCOPE_A)));

  const read = await withClient((c) => getMediaMigration(c, SCOPE_A, SHARED_ID, DEST));
  assert.equal(read?.status, 'verified');
  assert.equal(read?.verifiedHash, HASH);
  assert.equal(read?.attempts, 1);
  assert.equal(await withClient((c) => isMediaMigrationVerified(c, SCOPE_A, SHARED_ID, DEST)), true);
});

test('🚨 the SAME artifact id under another scope is a DIFFERENT migration', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * The catch this key exists for. Image ids are content-addressed, so one id
   * legitimately exists under several owners. Verifying one owner's copy and
   * treating the id as globally unique produced a migration "proof" while the
   * browser was reading a completely different scope's bytes.
   */
  assert.equal(await withClient((c) => isMediaMigrationVerified(c, SCOPE_B, SHARED_ID, DEST)), false);

  await withClient((c) => recordMediaMigration(c, entry(SCOPE_B)));
  assert.equal(await withClient((c) => isMediaMigrationVerified(c, SCOPE_B, SHARED_ID, DEST)), true);

  // Both exist independently — one did not overwrite the other.
  assert.notEqual(migrationId(SCOPE_A, SHARED_ID, DEST), migrationId(SCOPE_B, SHARED_ID, DEST));
  assert.ok(await withClient((c) => getMediaMigration(c, SCOPE_A, SHARED_ID, DEST)));
});

test('a retry updates the row and counts the attempt', async (t) => {
  if (skip) return t.skip(skip);
  const scope = 'scope-retry';
  await withClient((c) => recordMediaMigration(c, entry(scope, {
    status: 'failed', verifiedHash: undefined, verifiedAt: undefined,
    lastError: 'the destination returned nothing',
  })));
  await withClient((c) => recordMediaMigration(c, entry(scope)));

  const read = await withClient((c) => getMediaMigration(c, scope, SHARED_ID, DEST));
  assert.equal(read?.status, 'verified', 'the row is updated, not duplicated');
  assert.equal(read?.attempts, 2, 'and the attempt is counted');
  assert.equal(read?.lastError, undefined, 'and the stale error is cleared');
});

test('when something was first proven is history, not current state', async (t) => {
  if (skip) return t.skip(skip);
  // A later attempt that carries no timestamp must not erase the one that did.
  const scope = 'scope-history';
  await withClient((c) => recordMediaMigration(c, entry(scope)));
  await withClient((c) => recordMediaMigration(c, entry(scope, {
    status: 'failed', verifiedAt: undefined, copiedAt: undefined, lastError: 'transient',
  })));

  const read = await withClient((c) => getMediaMigration(c, scope, SHARED_ID, DEST));
  assert.equal(read?.verifiedAt, 1_700_000_000_000, 'the earlier proof timestamp survives');
  assert.equal(read?.status, 'failed', 'while the current status is honest');
});

test('the ledger can say what is left and what needs attention', async (t) => {
  if (skip) return t.skip(skip);
  await withClient((c) => recordMediaMigration(c, entry('scope-pending', {
    status: 'pending', verifiedHash: undefined, verifiedAt: undefined,
  })));

  const summary = await withClient((c) => summariseMediaMigrations(c));
  assert.ok(summary.verified >= 2, `verified: ${summary.verified}`);
  assert.ok(summary.pending >= 1);

  const unverified = await withClient((c) => listUnverifiedMediaMigrations(c));
  assert.ok(unverified.every((m) => m.status !== 'verified'));
  assert.ok(unverified.some((m) => m.scope === 'scope-pending'));
});

test('an artifact never migrated is not verified', async (t) => {
  if (skip) return t.skip(skip);
  assert.equal(await withClient((c) => isMediaMigrationVerified(c, 'nobody', 'img_' + 'f'.repeat(32), DEST)), false);
});


test('first proof, latest proof and last look are three different facts', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * The status can regress: an artifact proven today can fail a later re-check.
   * Overloading one timestamp would make "first ever proven", "most recently
   * proven" and "when did we last look" indistinguishable — and they are asked
   * for different reasons: provenance, freshness, and what to do next.
   */
  const scope = 'scope-timestamps';
  const FIRST = 1_700_000_000_000;
  const LATER = 1_700_000_999_000;

  await withClient((c) => recordMediaMigration(c, entry(scope, {
    at: FIRST, copiedAt: FIRST, verifiedAt: FIRST, lastVerifiedAt: FIRST,
  })));

  // A later re-check FAILS. First-ever proof must survive; freshness must not
  // advance; the last look must.
  await withClient((c) => recordMediaMigration(c, entry(scope, {
    at: LATER, status: 'failed', verifiedHash: undefined,
    verifiedAt: undefined, lastVerifiedAt: undefined, copiedAt: undefined,
    lastError: 'destination unreachable',
  })));

  const read = await withClient((c) => getMediaMigration(c, scope, SHARED_ID, DEST));
  assert.equal(read?.status, 'failed', 'current state is honest');
  assert.equal(read?.verifiedAt, FIRST, 'first proof is provenance and survives');
  assert.equal(read?.lastVerifiedAt, FIRST, 'freshness does not advance on a failure');
  assert.equal(read?.lastAttemptAt, LATER, 'but we did look again, and that is recorded');
  assert.equal(read?.copiedAt, FIRST, 'first copy survives too');
});

test('a later successful re-check advances freshness without rewriting history', async (t) => {
  if (skip) return t.skip(skip);
  const scope = 'scope-reproved';
  const FIRST = 1_700_000_000_000;
  const AGAIN = 1_700_500_000_000;

  await withClient((c) => recordMediaMigration(c, entry(scope, { at: FIRST, verifiedAt: FIRST, lastVerifiedAt: FIRST })));
  await withClient((c) => recordMediaMigration(c, entry(scope, { at: AGAIN, verifiedAt: AGAIN, lastVerifiedAt: AGAIN })));

  const read = await withClient((c) => getMediaMigration(c, scope, SHARED_ID, DEST));
  assert.equal(read?.verifiedAt, FIRST, 'first ever proof is unchanged');
  assert.equal(read?.lastVerifiedAt, AGAIN, 'most recent proof moved forward');
  assert.equal(read?.lastAttemptAt, AGAIN);
  assert.equal(read?.attempts, 2);
});
