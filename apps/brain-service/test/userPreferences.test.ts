/**
 * MigraPilot preferences against real PostgreSQL.
 *
 * Two properties that a mock cannot demonstrate, because both are claims about
 * the database:
 *
 *   ISOLATION — one account's preferences are invisible to another. Row-level
 *   security is the mechanism, so it has to be exercised as the NON-SUPERUSER
 *   application role; on a connection that bypasses RLS the assertion is
 *   meaningless.
 *
 *   CONCURRENT SAVES — two Settings tabs saving different preferences must not
 *   last-write-wins each other. That is a claim about `FOR UPDATE`.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { PostgresDurableStore } from '../src/engine/persistence/postgresStore.js';
import { DEFAULT_PREFERENCES } from '@migrapilot/shared-types/user-preferences';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let connection: PostgresConnection;
let store: PostgresDurableStore;

const scopeA = { owner: 'user:alice', workspace: 'personal:alice' };
const scopeB = { owner: 'user:bob', workspace: 'personal:bob' };
let seq = 0;
const patch = (scope: typeof scopeA, p: Record<string, unknown>) =>
  store.patchUserPreferences({
    scope, patch: p, now: 1_000 + (seq += 1), eventId: `ev-${seq}`,
    auditedKeys: ['memoryMode', 'saveHistory', 'retentionDays', 'autonomyLevel', 'customInstructions'],
  });

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
  const owner = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await owner.migrate();
  await owner.close();
  connection = new PostgresConnection({ databaseUrl: await appRoleUrl(pg.databaseUrl), max: 6 });
  store = new PostgresDurableStore(connection);
}, { timeout: 180_000 });

after(async () => {
  await connection?.close().catch(() => undefined);
  await pg?.stop();
});

test('a scope that has never saved gets defaults, and no row is created', { skip: skip ?? false }, async () => {
  // Opening Settings must not write to the database.
  const first = await store.getUserPreferences(scopeA);
  assert.deepEqual(first.preferences, DEFAULT_PREFERENCES);
  assert.equal(first.stored, false, 'these are defaults, not a saved decision');

  const second = await store.getUserPreferences(scopeA);
  assert.equal(second.stored, false, 'reading twice still creates nothing');
});

test('a saved preference survives, and reports itself as stored', { skip: skip ?? false }, async () => {
  await patch(scopeA, { responseStyle: 'technical', retentionDays: 30 });
  const row = await store.getUserPreferences(scopeA);
  assert.equal(row.stored, true);
  assert.equal(row.preferences.responseStyle, 'technical');
  assert.equal(row.preferences.retentionDays, 30);
  assert.equal(row.preferences.detailLevel, DEFAULT_PREFERENCES.detailLevel, 'untouched keys keep defaults');
});

test('one account cannot see or affect another\'s preferences', { skip: skip ?? false }, async () => {
  await patch(scopeB, { responseStyle: 'friendly' });

  const a = await store.getUserPreferences(scopeA);
  const b = await store.getUserPreferences(scopeB);
  assert.equal(a.preferences.responseStyle, 'technical');
  assert.equal(b.preferences.responseStyle, 'friendly');
  assert.equal(b.preferences.retentionDays, DEFAULT_PREFERENCES.retentionDays, "bob never got alice's retention");
});

test('CONCURRENT saves of different keys do not overwrite each other', { skip: skip ?? false }, async () => {
  /*
   * Two Settings tabs. Without `FOR UPDATE` both read the same document, each
   * merges its own change, and the second write erases the first's — the user
   * changes two things and one silently reverts.
   */
  await patch(scopeA, { responseStyle: 'neutral', detailLevel: 'balanced' });

  await Promise.all([
    patch(scopeA, { responseStyle: 'concise' }),
    patch(scopeA, { detailLevel: 'thorough' }),
  ]);

  const row = await store.getUserPreferences(scopeA);
  assert.equal(row.preferences.responseStyle, 'concise', 'the first tab\'s change survived');
  assert.equal(row.preferences.detailLevel, 'thorough', 'and so did the second\'s');
});

test('audited changes are recorded; cosmetic ones are not', { skip: skip ?? false }, async () => {
  const before = (await store.listPreferenceEvents(scopeA)).length;
  await patch(scopeA, { theme: 'dark' });
  assert.equal((await store.listPreferenceEvents(scopeA)).length, before, 'theme is not security-relevant');

  await patch(scopeA, { memoryMode: 'off' });
  const events = await store.listPreferenceEvents(scopeA);
  assert.equal(events.length, before + 1, 'turning memory off is');
  assert.ok(events[0]!.changedKeys.includes('memoryMode'));
});

test('the audit records WHICH key changed, never the value', { skip: skip ?? false }, async () => {
  // Custom instructions can contain anything the user typed; the fact that they
  // changed is auditable, the contents are not.
  await patch(scopeA, { customInstructions: 'a private note about my employer' });
  const events = await store.listPreferenceEvents(scopeA);
  const serialized = JSON.stringify(events);
  assert.ok(serialized.includes('customInstructions'));
  assert.ok(!serialized.includes('private note'), 'the value must never reach the audit trail');
});

test('deleting preferences removes the document and its events', { skip: skip ?? false }, async () => {
  const removed = await store.deleteUserPreferences(scopeA);
  assert.ok(removed.preferences >= 1);
  assert.ok(removed.events >= 1);

  const after = await store.getUserPreferences(scopeA);
  assert.equal(after.stored, false, 'back to defaults, with nothing left behind');
  assert.equal((await store.listPreferenceEvents(scopeA)).length, 0);

  // And bob is untouched by alice's deletion.
  assert.equal((await store.getUserPreferences(scopeB)).preferences.responseStyle, 'friendly');
});
