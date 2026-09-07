/**
 * PERSISTENCE PARITY — the same contract, asserted against both adapters.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS SUITE EXISTS FOR
 *
 * Project binding and durable idempotency shipped with SQLite tables and a
 * composition root that read `durable instanceof SqliteDurableStore ? … : new
 * InMemory…()`. Production runs PostgreSQL, so production took the memory
 * branch: a connected project would have vanished on the next Brain restart,
 * silently. Nothing local could see it — the rig runs SQLite and always took
 * the durable branch.
 *
 * A suite that ran against one adapter would have the same blind spot. So every
 * case below runs against BOTH, from one table of cases, and a behaviour that
 * differs between them is a failure rather than a footnote.
 *
 * ---------------------------------------------------------------------------
 * 🚨 POSTGRES IS THE CANONICAL BACKEND, SO THIS SUITE FAILS WITHOUT IT
 *
 * Not "skips". A skip still exits zero, so a CI run with no database would go
 * GREEN having exercised only SQLite — which is precisely the false green that
 * produced this defect and would hide its return.
 *
 * There is deliberately no opt-out environment variable either: a flag that
 * downgrades this to a skip is the silent-degradation door in a different
 * costume. If Postgres is unreachable, the parity claim cannot be made, and a
 * claim that cannot be made must not be reported as proven.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { PostgresDurableStore } from '../src/engine/persistence/postgresStore.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import {
  hasIdempotency,
  hasProjectBindings,
  type DurableStore,
  type PersistenceScope,
} from '../src/engine/persistence/types.js';
import { durableProjectBindings } from '../src/engine/projects/durableProjectBindings.js';
import { IdempotencyStore } from '../src/engine/tools/idempotencyStore.js';
import type { OperationIdentity } from '../src/engine/tools/idempotency.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

const SCOPE: PersistenceScope = { owner: 'user:alpha', workspace: 'ws:one' };
const OTHER: PersistenceScope = { owner: 'user:beta', workspace: 'ws:one' };

const identity = (over: Partial<OperationIdentity> = {}): OperationIdentity => ({
  idempotencyKey: 'idem_parity',
  toolId: 'conversations.rename',
  actor: 'user:alpha',
  scope: 'user:alpha/ws:one',
  normalizedInputHash: 'sha256:aaa',
  ...over,
});

let pgSkip: string | null = null;
let pg: DisposablePostgres | undefined;
let pgConnection: PostgresConnection | undefined;
let pgStore: PostgresDurableStore | undefined;
let sqlitePath = '';

before(async () => {
  sqlitePath = join(mkdtempSync(join(tmpdir(), 'parity-')), 'state.db');

  pgSkip = await postgresTestSkipReason();
  if (pgSkip) {
    // FAIL, not skip. See the header.
    throw new Error(
      `PERSISTENCE PARITY CANNOT BE PROVEN: ${pgSkip}\n` +
        '  PostgreSQL is the canonical production backend. A run that exercised only\n' +
        '  SQLite would report parity it never tested — the exact false green that let\n' +
        '  project bindings reach production as in-memory state.\n' +
        '  Start a PostgreSQL the disposable harness can reach, then re-run.',
    );
  }
  pg = await startDisposablePostgres();
  const owner = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await owner.migrate();
  await owner.close();
  pgConnection = new PostgresConnection({ databaseUrl: await appRoleUrl(pg.databaseUrl) });
  pgStore = new PostgresDurableStore(pgConnection);
}, { timeout: 180_000 });

after(async () => {
  await pgConnection?.close().catch(() => undefined);
  await pg?.stop();
});

function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('package root not found from ' + fileURLToPath(import.meta.url));
}

/** Fresh SQLite store on the shared file, so a "restart" is a new handle. */
const sqlite = (): SqliteDurableStore => new SqliteDurableStore(sqlitePath);

/* ------------------------------------------------------------------ *
 * Both adapters must ANSWER the capability
 * ------------------------------------------------------------------ */

describe('capability detection is structural, never a class check', () => {
  it('SQLite implements both capabilities', () => {
    const store = sqlite() as unknown as DurableStore;
    assert.ok(hasProjectBindings(store), 'SQLite must offer project bindings');
    assert.ok(hasIdempotency(store), 'SQLite must offer idempotency');
  });

  it('🚨 POSTGRES implements both capabilities — the gap that shipped', (t) => {
    if (pgSkip) throw new Error(`postgres unavailable: ${pgSkip}`);
    assert.ok(hasProjectBindings(pgStore as never), 'Postgres must offer project bindings');
    assert.ok(hasIdempotency(pgStore as never), 'Postgres must offer idempotency');
  });

  it('a store WITHOUT the methods is refused, not degraded', () => {
    // The negative control: capability detection must actually say no.
    assert.equal(hasProjectBindings({} as object), false);
    assert.equal(hasIdempotency({ idempotencyRead: () => null } as object), false);
  });
});

/* ------------------------------------------------------------------ *
 * One table of cases, run against both
 * ------------------------------------------------------------------ */

const backings: Array<[string, () => DurableStore | undefined]> = [
  ['sqlite', () => sqlite() as unknown as DurableStore],
  ['postgres', () => pgStore as unknown as DurableStore | undefined],
];

for (const [name, make] of backings) {
  /*
   * Unreachable in practice — `before` already threw. Kept so a future change
   * that relaxes the setup cannot quietly turn these into silent passes.
   */
  const guard = (_t: { skip: (reason?: string) => void }): boolean => {
    if (name === 'postgres' && pgSkip) throw new Error(`postgres unavailable: ${pgSkip}`);
    return false;
  };

  describe(`${name}: project binding contract`, () => {
    it('binds, reads back, and rebinds in place', async (t) => {
      if (guard(t)) return;
      const bindings = durableProjectBindings(make() as never);
      await bindings.bind({ conversationId: 'conv_p1', projectId: 'ws_1', boundBy: 'u', boundAt: 11 }, SCOPE);
      assert.equal((await bindings.get('conv_p1', SCOPE))?.projectId, 'ws_1');

      await bindings.bind({ conversationId: 'conv_p1', projectId: 'ws_2', boundBy: 'u', boundAt: 12 }, SCOPE);
      const rebound = await bindings.get('conv_p1', SCOPE);
      assert.equal(rebound?.projectId, 'ws_2', 'rebinding replaces');
      assert.equal(rebound?.boundAt, 12, 'and BIGINT round-trips as a number');
    });

    it('is scoped — another tenant cannot see it', async (t) => {
      if (guard(t)) return;
      const bindings = durableProjectBindings(make() as never);
      await bindings.bind({ conversationId: 'conv_p2', projectId: 'ws_1', boundBy: 'u', boundAt: 1 }, SCOPE);
      assert.equal(await bindings.get('conv_p2', OTHER), null);
    });

    it('unbind removes it and nothing else', async (t) => {
      if (guard(t)) return;
      const bindings = durableProjectBindings(make() as never);
      await bindings.bind({ conversationId: 'conv_p3', projectId: 'ws_1', boundBy: 'u', boundAt: 1 }, SCOPE);
      await bindings.bind({ conversationId: 'conv_p4', projectId: 'ws_9', boundBy: 'u', boundAt: 1 }, SCOPE);
      await bindings.unbind('conv_p3', SCOPE);
      assert.equal(await bindings.get('conv_p3', SCOPE), null);
      assert.equal((await bindings.get('conv_p4', SCOPE))?.projectId, 'ws_9', 'a sibling is untouched');
    });
  });

  describe(`${name}: idempotency contract`, () => {
    const store = () => new IdempotencyStore({ persistence: adapt(make() as never) });

    it('claims once; a second caller is in flight, not claimed', async (t) => {
      if (guard(t)) return;
      const s = store();
      const key = identity({ idempotencyKey: `k1_${name}` });
      assert.equal((await s.claim(key)).kind, 'claimed');
      assert.equal((await s.claim(key)).kind, 'in_flight');
    });

    it('🚨 the same key with a different input hash is REFUSED', async (t) => {
      if (guard(t)) return;
      const s = store();
      const key = identity({ idempotencyKey: `k2_${name}` });
      await s.claim(key);
      const verdict = await s.claim({ ...key, normalizedInputHash: 'sha256:different' });
      assert.equal(verdict.kind, 'refused');
      assert.equal(verdict.kind === 'refused' && verdict.mismatch, 'input-changed');
    });

    it('committed returns the durable result and cannot dispatch again', async (t) => {
      if (guard(t)) return;
      const s = store();
      const key = identity({ idempotencyKey: `k3_${name}` });
      await s.claim(key);
      await s.commit(key, { title: 'done' }, { requestId: 'req_1' });
      const verdict = await s.claim(key);
      assert.equal(verdict.kind, 'already_committed');
      assert.deepEqual(verdict.record.result, { title: 'done' });
      assert.equal(verdict.record.provenance?.requestId, 'req_1');
    });

    it('outcome_unknown needs reconciliation, never a retry', async (t) => {
      if (guard(t)) return;
      const s = store();
      const key = identity({ idempotencyKey: `k4_${name}` });
      await s.claim(key);
      await s.markOutcomeUnknown(key, 'connection lost after dispatch');
      assert.equal((await s.claim(key)).kind, 'needs_reconciliation');
      await assert.rejects(() => s.reattempt(key), /reconcile it, never retry it/);
    });

    it('transitions stay monotonic — committed never walks back', async (t) => {
      if (guard(t)) return;
      const s = store();
      const key = identity({ idempotencyKey: `k5_${name}` });
      await s.claim(key);
      await s.commit(key, { ok: true });
      await assert.rejects(() => s.commit(key, { ok: true }), /ILLEGAL IDEMPOTENCY TRANSITION/);
      await assert.rejects(() => s.reattempt(key), /NOT PERMITTED from committed/);
    });
  });
}

/* ------------------------------------------------------------------ *
 * Restart durability — the property the whole slice exists for
 * ------------------------------------------------------------------ */

describe('production never substitutes in-memory state', () => {
  /*
   * A WIRING CHECK, and only that: does the composition root still contain the
   * pattern that caused this? Matching source text answers that exactly. What
   * it cannot answer — whether the durable path works — is answered
   * behaviourally by every case above, against both adapters.
   *
   * The invariant, in the platform's words: if a feature requires durable
   * state, production must either have its canonical durable repository or
   * refuse to expose that feature. It may never silently substitute in-memory
   * state.
   */
  /*
   * 🚨 READ THE SOURCE TREE, WHEREVER THIS RUNS FROM — the third time this
   * pattern has bitten in this codebase.
   *
   * `../src` is right under tsx and WRONG under `npm test`, which runs the
   * compiled copy from `dist/test/`: there it resolves to `dist/src/server.ts`,
   * which does not exist. A guard that reads the wrong artifact is worse than
   * none — it either crashes, as here, or silently inspects emitted JavaScript
   * instead of the file a person edits. Walk to the package root instead.
   */
  const server = readFileSync(join(packageRoot(), 'src', 'server.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('🚨 the composition root does not construct an in-memory binding store', () => {
    assert.doesNotMatch(
      server,
      /new InMemoryProjectBindingStore\(/,
      'production would serve a connection that vanishes on the next restart',
    );
    assert.doesNotMatch(server, /new InMemoryIdempotencyPersistence\(/);
  });

  it('🚨 it asks the STORE for the capability, never the class', () => {
    assert.doesNotMatch(
      server,
      /instanceof SqliteDurableStore/,
      'an instanceof check silently disables the feature for every other adapter',
    );
    assert.match(server, /hasProjectBindings\(/, 'capability detection must be structural');
  });

  it('🚨 the feature is REFUSED when the capability is absent, and says so', () => {
    assert.match(server, /if \(projectBindings\) registerProjectRoutes/, 'routes are gated on the capability');
    assert.match(server, /if \(projectBindings\) registerProjectInspectRoutes/);
    assert.match(server, /PROJECT CONNECT DISABLED/, 'and the reason is logged, not swallowed');
  });
});

describe('durability across a restart', () => {
  it('sqlite: a binding and a committed operation survive a new handle', async () => {
    const before = sqlite() as unknown as DurableStore;
    await durableProjectBindings(before).bind(
      { conversationId: 'conv_restart', projectId: 'ws_keep', boundBy: 'u', boundAt: 5 }, SCOPE);
    await new IdempotencyStore({ persistence: adapt(before) })
      .claim(identity({ idempotencyKey: 'k_restart_sqlite' }));

    // A new process would see exactly this: a fresh handle to the same file.
    const after = sqlite() as unknown as DurableStore;
    assert.equal((await durableProjectBindings(after).get('conv_restart', SCOPE))?.projectId, 'ws_keep');
    assert.equal(
      (await new IdempotencyStore({ persistence: adapt(after) })
        .claim(identity({ idempotencyKey: 'k_restart_sqlite' }))).kind,
      'in_flight',
      'the claim is still held after a restart',
    );
  });

  it('🚨 POSTGRES: the same, on the canonical backend', async (t) => {
    if (pgSkip) throw new Error(`postgres unavailable: ${pgSkip}`);
    const store = pgStore as unknown as DurableStore;
    await durableProjectBindings(store).bind(
      { conversationId: 'conv_pg_restart', projectId: 'ws_pg', boundBy: 'u', boundAt: 7 }, SCOPE);
    await new IdempotencyStore({ persistence: adapt(store) })
      .claim(identity({ idempotencyKey: 'k_restart_pg' }));

    // A genuinely new connection — the closest thing to a restart for a pool.
    const reconnected = new PostgresConnection({ databaseUrl: await appRoleUrl(pg!.databaseUrl) });
    const fresh = new PostgresDurableStore(reconnected) as unknown as DurableStore;
    assert.equal(
      (await durableProjectBindings(fresh).get('conv_pg_restart', SCOPE))?.projectId,
      'ws_pg',
      'a connected project must not vanish when the Brain restarts',
    );
    assert.equal(
      (await new IdempotencyStore({ persistence: adapt(fresh) })
        .claim(identity({ idempotencyKey: 'k_restart_pg' }))).kind,
      'in_flight',
    );
    await reconnected.close();
  });
});

/** Bridge the store's capability methods onto the IdempotencyPersistence port. */
function adapt(store: DurableStore) {
  return {
    insertIfAbsent: (r: never) => store.idempotencyInsertIfAbsent(r) as never,
    read: (k: string, a: string, s: string) => store.idempotencyRead(k, a, s) as never,
    write: (r: never) => store.idempotencyWrite(r),
  } as never;
}
