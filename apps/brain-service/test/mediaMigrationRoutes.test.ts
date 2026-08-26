/**
 * Migration state over HTTP, with the boundary the consumer relies on.
 *
 * The consumer has no database credentials and should not get any — the Brain is
 * the durable authority. These routes are the narrow opening for exactly what it
 * needs, and the property that matters most is that a caller cannot name someone
 * else's bucket.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { registerMediaMigrationRoutes, mediaScopeFor } from '../src/engine/media/mediaMigrationRoutes.js';
import { installJsonBodyParser } from '../src/http/jsonBodyParser.js';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import {
  postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let connection: PostgresConnection;
let app: FastifyInstance;

const DEST = 'minio:migrapilot-artifacts';
const ARTIFACT = 'img_' + 'c'.repeat(32);
const HASH = 'd'.repeat(64);
const ALICE = { 'x-owner-scope': 'user:alice', 'x-workspace-scope': 'personal:alice' };
const BOB = { 'x-owner-scope': 'user:bob', 'x-workspace-scope': 'personal:bob' };

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
  connection = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await connection.migrate();
  app = Fastify();
  installJsonBodyParser(app);
  registerMediaMigrationRoutes(app, {
    transaction: <T>(fn: (c: PoolClient) => Promise<T>) => connection.transaction(fn),
  });
});

after(async () => {
  await app?.close().catch(() => undefined);
  await connection?.close().catch(() => undefined);
  await pg?.stop().catch(() => undefined);
});

const record = (headers: Record<string, string>, overrides: Record<string, unknown> = {}) =>
  app.inject({
    method: 'PUT', url: `/api/ai/media/migrations/${ARTIFACT}`, headers,
    payload: {
      sourceProvider: 'local-filesystem', sourceKey: `x/${ARTIFACT}.png`,
      destinationProvider: DEST, destinationKey: `x/${ARTIFACT}.png`,
      expectedHash: HASH, verifiedHash: HASH, status: 'verified',
      copiedAt: 1_700_000_000_000, verifiedAt: 1_700_000_000_000,
      ...overrides,
    },
  });

test('a migration is recorded and read back', async (t) => {
  if (skip) return t.skip(skip);
  assert.equal((await record(ALICE)).statusCode, 200);

  const read = await app.inject({
    method: 'GET', url: `/api/ai/media/migrations/${ARTIFACT}?destination=${encodeURIComponent(DEST)}`,
    headers: ALICE,
  });
  assert.equal(read.statusCode, 200);
  const body = read.json() as { verified: boolean; migration: { status: string; verifiedHash: string; scope: string } };
  assert.equal(body.verified, true);
  assert.equal(body.migration.verifiedHash, HASH);
  assert.equal(body.migration.scope, mediaScopeFor('user:alice'), 'scope was derived, not supplied');
});

test('🚨 one account cannot see or overwrite another account migration state', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * The scope is a hash of the VERIFIED owner header, never anything in the
   * body. A caller that could name its own bucket could read or rewrite another
   * account's state — the same identity confusion that already produced one
   * false migration proof.
   */
  const asBob = await app.inject({
    method: 'GET', url: `/api/ai/media/migrations/${ARTIFACT}?destination=${encodeURIComponent(DEST)}`,
    headers: BOB,
  });
  assert.equal(asBob.statusCode, 404, "Bob sees nothing of Alice's");

  // Bob records his own, and Alice's is untouched.
  await record(BOB, { status: 'failed', verifiedHash: undefined, lastError: 'nope' });
  const alice = await app.inject({
    method: 'GET', url: `/api/ai/media/migrations/${ARTIFACT}?destination=${encodeURIComponent(DEST)}`,
    headers: ALICE,
  });
  assert.equal((alice.json() as { migration: { status: string } }).migration.status, 'verified');
});

test('a body that tries to name a scope is ignored, not honoured', async (t) => {
  if (skip) return t.skip(skip);
  await record(ALICE, { scope: mediaScopeFor('user:bob') } as Record<string, unknown>);
  const read = await app.inject({
    method: 'GET', url: `/api/ai/media/migrations/${ARTIFACT}?destination=${encodeURIComponent(DEST)}`,
    headers: ALICE,
  });
  assert.equal((read.json() as { migration: { scope: string } }).migration.scope, mediaScopeFor('user:alice'));
});

test('an unidentified caller gets no bucket at all', async (t) => {
  if (skip) return t.skip(skip);
  // Defaulting would put one caller's state in a namespace shared with everyone
  // else who also failed to identify.
  const anon = await app.inject({ method: 'GET', url: `/api/ai/media/migrations?limit=5` });
  assert.equal(anon.statusCode, 400);
});

test('malformed input is refused rather than stored', async (t) => {
  if (skip) return t.skip(skip);
  const badId = await app.inject({
    method: 'PUT', url: '/api/ai/media/migrations/not-an-artifact', headers: ALICE,
    payload: { sourceProvider: 'l', destinationProvider: DEST, destinationKey: 'k', expectedHash: HASH, status: 'verified' },
  });
  assert.equal(badId.statusCode, 400);

  const badStatus = await record(ALICE, { status: 'probably-fine' });
  assert.equal(badStatus.statusCode, 400);

  const missing = await app.inject({
    method: 'PUT', url: `/api/ai/media/migrations/${ARTIFACT}`, headers: ALICE,
    payload: { status: 'verified' },
  });
  assert.equal(missing.statusCode, 400);
});

test('an artifact never migrated is NOT_MIGRATED, distinct from unverified', async (t) => {
  if (skip) return t.skip(skip);
  const read = await app.inject({
    method: 'GET',
    url: `/api/ai/media/migrations/img_${'e'.repeat(32)}?destination=${encodeURIComponent(DEST)}`,
    headers: ALICE,
  });
  assert.equal(read.statusCode, 404);
  assert.equal((read.json() as { code: string }).code, 'NOT_MIGRATED');
});

test('the reconciliation view is bounded and scoped to the caller', async (t) => {
  if (skip) return t.skip(skip);
  const listed = await app.inject({ method: 'GET', url: '/api/ai/media/migrations?limit=5', headers: BOB });
  assert.equal(listed.statusCode, 200);
  const body = listed.json() as { summary: Record<string, number>; unverified: { scope: string }[] };
  assert.ok((body.summary.verified ?? 0) >= 1);
  assert.ok(body.unverified.every((m) => m.scope === mediaScopeFor('user:bob')));
});
