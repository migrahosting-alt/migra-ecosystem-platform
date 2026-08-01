// Runtime proofs, through PRODUCTION wiring rather than store methods.
//
// The store's own tests show that `saveOperation` and `saveConnection` touch different
// files. That is not the same claim as "a health poll cannot rewrite a completed run"
// — the interesting failure is a wiring mistake, not a store bug — so these drive the
// real BrainClient, the real BrainConnectionState, and the real activation core.

import assert from 'node:assert/strict';
import test from 'node:test';

import { BrainClient, type BrainConfig, type BrainLogSink } from '../../services/brainClient.js';
import { BrainConnectionState } from '../../services/brainConnection.js';
import {
  BrainStore,
  bootstrapBrainStoreAt,
  connectionPersister,
  operationPersister,
  type StorageFs,
} from '../../services/brainPersistence.js';
import type { FetchLike } from '../../services/brainTransport.js';

const sink: BrainLogSink = { appendLine: () => {} };
const config = (): BrainConfig => ({
  baseUrl: () => 'http://127.0.0.1:3988',
  timeoutMs: () => 40,
  connectionTimeoutMs: () => 40,
});
const json = (body: unknown): FetchLike => async () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const instantScheduler = { delay: async () => {} };

/** Records the ORDER of every fs effect, not just the final contents. */
function tracingFs() {
  const files = new Map<string, string>();
  const trace: string[] = [];
  const fs: StorageFs = {
    mkdir: async (p) => { trace.push(`mkdir ${p}`); },
    readFile: async (p) => {
      trace.push(`read ${p}`);
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFile: async (p, d) => { trace.push(`write ${p}`); files.set(p, d); },
    rename: async (a, b) => { trace.push(`rename ${b}`); files.set(b, files.get(a)!); files.delete(a); },
    readdir: async (p) => { trace.push(`readdir ${p}`); return [...files.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => k.slice(p.length + 1)); },
    exists: async (p) => files.has(p),
  };
  return { fs, files, trace };
}

const opFiles = (files: Map<string, string>) =>
  [...files].filter(([k]) => k.includes('/operations/')).map(([k, v]) => `${k}=${v}`).sort().join('\n');

test('runtime · health polling cannot alter a completed operation record', async () => {
  const t = tracingFs();
  const store = new BrainStore('/gs', t.fs);
  await store.init();

  // A real governed operation, run to a durable terminal revision.
  const c = new BrainClient(sink, config(), json({ content: 'ok' }), undefined, instantScheduler);
  const out = await c.chatGoverned({} as never, undefined, undefined, operationPersister(store, () => {}));
  assert.equal(out.durable, true);
  const before = opFiles(t.files);
  assert.notEqual(before, '', 'the operation must actually be on disk for this test to mean anything');

  // Now hammer the connection path through its production persister.
  const conn = new BrainConnectionState('http://127.0.0.1:3988', { failureThreshold: 3 }, () => '2026-01-01T00:00:00.000Z', connectionPersister(store, () => {}, () => '2026-01-01T00:00:00.000Z'));
  for (let i = 0; i < 5; i += 1) {
    conn.probeStarted();
    conn.probeFailed({ cause: { code: 'ECONNREFUSED' } });
  }
  conn.probeSucceeded(4242);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(conn.readiness, 'ready', 'the connection path did do work');
  assert.ok(t.files.has('/gs/connection.json'), 'and did write its own file');
  assert.equal(opFiles(t.files), before, 'the operation record is byte-identical');
});

test('runtime · operation writes cannot alter connection.json', async () => {
  const t = tracingFs();
  const store = new BrainStore('/gs', t.fs);
  await store.init();

  const conn = new BrainConnectionState('http://127.0.0.1:3988', { failureThreshold: 3 }, () => '2026-01-01T00:00:00.000Z', connectionPersister(store, () => {}, () => '2026-01-01T00:00:00.000Z'));
  conn.probeStarted();
  conn.probeSucceeded(1);
  await new Promise((r) => setImmediate(r));
  const before = t.files.get('/gs/connection.json');
  assert.ok(before, 'connection.json must exist for this test to mean anything');

  const c = new BrainClient(sink, config(), json({ content: 'ok' }), undefined, instantScheduler);
  await c.chatGoverned({} as never, undefined, undefined, operationPersister(store, () => {}));
  await c.chatGoverned({} as never, undefined, undefined, operationPersister(store, () => {}));

  assert.equal(t.files.get('/gs/connection.json'), before, 'connection.json is untouched by operation writes');
});

test('runtime · recovery is persisted before activation resolves, so polling cannot precede it', async () => {
  const t = tracingFs();
  // An operation interrupted mid-run by a restart.
  const seed = new BrainStore('/gs', t.fs);
  await seed.init();
  const c = new BrainClient(sink, config(), json({ content: 'ok' }), undefined, instantScheduler);
  const p = operationPersister(seed, () => {});
  const hung = new Promise<void>(() => {});
  void c.chatGoverned({} as never, undefined, undefined, p).catch(() => {});
  await Promise.race([hung, new Promise((r) => setImmediate(r))]);

  // Restart: nothing may probe until bootstrap settles.
  t.trace.length = 0;
  let probes = 0;
  const boot = bootstrapBrainStoreAt('/gs', t.fs, () => {});
  const startPolling = boot.then(() => { probes += 1; });
  assert.equal(probes, 0, 'no probe before bootstrap resolves');
  await startPolling;

  const firstWriteAfterLoad = t.trace.findIndex((e) => e.startsWith('rename') || e.startsWith('write'));
  const firstRead = t.trace.findIndex((e) => e.startsWith('read') || e.startsWith('readdir'));
  assert.ok(firstRead >= 0, 'bootstrap must read the store');
  if (firstWriteAfterLoad >= 0) {
    assert.ok(firstRead < firstWriteAfterLoad, 'records load before recovery is written');
  }
  assert.equal(probes, 1, 'the first probe happens only after bootstrap resolved');
});
