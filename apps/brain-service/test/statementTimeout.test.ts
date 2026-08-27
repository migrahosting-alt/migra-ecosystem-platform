/**
 * `statement_timeout` must actually be in force on every connection.
 *
 * It was applied from a `pool.on('connect')` handler with a fire-and-forget
 * `void client.query(...)`. `pg` emits `connect` and then immediately hands the
 * client to whoever was waiting, so the caller's first query races the SET —
 * which is what produced:
 *
 *   DeprecationWarning: Calling client.query() when the client is already
 *   executing a query is deprecated and will be removed in pg@9.0
 *
 * MEASURED BEFORE CHANGING ANYTHING, because the warning could have meant two
 * very different things. It is NOT losing the timeout: pg queues per-client
 * queries, so the SET ran first and `SHOW statement_timeout` returned the
 * configured value on the very first statement. So this was forward
 * compatibility, not correctness — it was never a cutover blocker.
 *
 * Fixed anyway: in pg@9 the overlap becomes an error, and "a client is handed
 * out while a query is still in flight" is the kind of thing that stops being
 * benign under load. The setting now travels in the startup packet, so the
 * server applies it before the connection is usable and there is nothing to
 * race.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import {
  postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
}, { timeout: 180_000 });

after(async () => {
  await pg?.stop();
});

test('statement_timeout is in force on the VERY FIRST query of a connection',
  async (t) => {
    if (skip) return t.skip(skip);
    const connection = new PostgresConnection({
      databaseUrl: pg.databaseUrl, statementTimeoutMillis: 4_321,
    });
    try {
      // The first statement this connection ever runs. Under the old
      // connect-handler approach this raced the SET and could observe the
      // server default instead.
      const rows = await connection.query<{ statement_timeout: string }>('SHOW statement_timeout');
      assert.equal(rows[0]?.statement_timeout, '4321ms',
        'the timeout must be established before the connection is handed out');
    } finally {
      await connection.close();
    }
  });

test('every pooled connection gets it, not just the first', async (t) => {
  if (skip) return t.skip(skip);
  const connection = new PostgresConnection({
    databaseUrl: pg.databaseUrl, statementTimeoutMillis: 7_000, max: 4,
  });
  try {
    // Force several distinct backends to be opened concurrently.
    const seen = await Promise.all(
      Array.from({ length: 4 }, () => connection.transaction(async (client) => {
        const r = await client.query<{ statement_timeout: string }>('SHOW statement_timeout');
        return r.rows[0]?.statement_timeout;
      })),
    );
    assert.deepEqual(seen, ['7s', '7s', '7s', '7s']);
  } finally {
    await connection.close();
  }
});

test('a statement that exceeds the timeout is actually cancelled', async (t) => {
  if (skip) return t.skip(skip);
  // Proves the setting has teeth rather than merely being reported by SHOW.
  const connection = new PostgresConnection({
    databaseUrl: pg.databaseUrl, statementTimeoutMillis: 300,
  });
  try {
    await assert.rejects(
      () => connection.query('SELECT pg_sleep(3)'),
      /statement timeout|canceling statement/i,
    );
  } finally {
    await connection.close();
  }
});

test('the pool installs NO query-issuing connect handler', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * Asserting on the DeprecationWarning itself does not work: Node emits a
   * given deprecation ONCE per process, so by the time this test attached a
   * listener an earlier test had already consumed it, and the assertion passed
   * without proving anything. A vacuous test is worse than none.
   *
   * The structural property is what actually matters and is directly
   * observable: nothing may run a query behind the caller's back on a client
   * that has already been handed out.
   */
  const connection = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  try {
    const pool = (connection as unknown as { pool: { listenerCount(e: string): number } }).pool;
    assert.equal(pool.listenerCount('connect'), 0,
      'statement_timeout belongs in the startup packet, not in a connect-handler query');
    // And the setting is still really there — see the first case.
    const rows = await connection.query<{ statement_timeout: string }>('SHOW statement_timeout');
    assert.equal(rows[0]?.statement_timeout, '30s', 'the default bound is applied');
  } finally {
    await connection.close();
  }
});
