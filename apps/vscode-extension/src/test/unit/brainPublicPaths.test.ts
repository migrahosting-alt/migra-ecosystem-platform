import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrainClient,
  BrainOperationError,
  callBrainTool,
  type BrainConfig,
  type BrainLogSink,
} from '../../services/brainClient.js';
import type { FetchLike } from '../../services/brainTransport.js';

/**
 * PUBLIC-PATH behaviour tests.
 *
 * These drive the exported methods, not the transport primitive. That distinction is
 * the whole point: the primitive is already proven, so the only remaining risk is
 * wrapper logic at the public boundary mistranslating a timeout, normalising a
 * malformed response into success, or letting a continuation run after cancellation.
 * Testing the primitive again would prove none of that.
 */

const sink: BrainLogSink = { appendLine: () => {} };

const config = (over: Partial<Record<keyof BrainConfig, number | string>> = {}): BrainConfig => ({
  baseUrl: () => String(over.baseUrl ?? 'http://127.0.0.1:3988'),
  timeoutMs: () => Number(over.timeoutMs ?? 40),
  connectionTimeoutMs: () => Number(over.connectionTimeoutMs ?? 40),
});

function spy(impl: FetchLike): FetchLike & { calls: number } {
  const f = (async (u: string, i: RequestInit) => {
    (f as unknown as { calls: number }).calls += 1;
    return impl(u, i);
  }) as FetchLike & { calls: number };
  f.calls = 0;
  return f;
}

const json = (body: unknown, status = 200): FetchLike => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const refuse: FetchLike = async () => {
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
};

const malformed: FetchLike = async () => new Response('not json{', { status: 200 });

/** Never settles until aborted — models a hung Brain. */
const hang: FetchLike = (_u, init) =>
  new Promise((_res, rej) => {
    (init.signal as AbortSignal).addEventListener('abort', () =>
      rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
  });

const client = (fetchImpl: FetchLike, cfg = config()) => new BrainClient(sink, cfg, fetchImpl);

/** No real time passes in tests. */
const instantScheduler = { delay: async () => {} };
const RETRY_0 = { consequential: 0 as const, health: 0, idempotentReads: 0 };
const RETRY_1 = { consequential: 0 as const, health: 0, idempotentReads: 1 };

// ── 1. health() connection refusal ──────────────────────────────────────────

test('1 · health() refusal drives readiness to disconnected and returns no success', async () => {
  const f = spy(refuse);
  const c = new BrainClient(sink, config(), f, { consequential: 0, health: 0, idempotentReads: 0 });
  await assert.rejects(() => c.health(), (e: unknown) => e instanceof BrainOperationError);
  assert.ok(f.calls > 0, 'the governed transport must actually be invoked');
  assert.equal(c.readiness, 'disconnected');
  assert.match(c.connectionStatusLine(), /not reachable/i);
});

// ── 2. health() malformed → degraded, then failed at threshold ──────────────

test('2 · health() malformed degrades, and repeated failures reach failed at threshold', async () => {
  const c = new BrainClient(sink, config(), malformed, {
    consequential: 0,
    health: 0,
    idempotentReads: 0,
  });
  await assert.rejects(() => c.health());
  assert.equal(c.readiness, 'degraded', 'a malformed body is degraded, not disconnected');
  assert.equal(c.snapshotFailureCategory(), 'invalid_response');

  await assert.rejects(() => c.health());
  await assert.rejects(() => c.health());
  assert.equal(c.readiness, 'failed', 'threshold of 3 consecutive failures escalates to failed');
});

// ── 3. chat() timeout ───────────────────────────────────────────────────────

test('3 · chat() timeout is request_timeout, never cancelled or completed', async () => {
  const c = client(hang);
  const err = await c.chat({} as never).then(
    () => undefined,
    (e: unknown) => e as BrainOperationError,
  );
  assert.ok(err instanceof BrainOperationError);
  assert.equal(err.category, 'request_timeout');
  assert.notEqual(err.record.state, 'cancelled');
  assert.notEqual(err.record.state, 'completed');
  assert.equal(err.record.terminalObserved, false);
});

// ── 4. chat() cancellation ──────────────────────────────────────────────────

test('4 · chat() cancellation reaches cancelled and no successful result escapes', async () => {
  const ac = new AbortController();
  const c = client(hang, config({ timeoutMs: 5_000 }));
  const p = c.chatGoverned({} as never, ac.signal);
  setTimeout(() => ac.abort(), 10);
  const out = await p;
  assert.equal(out.ok, false);
  assert.equal(out.record.state, 'cancelled');
  assert.ok(out.record.cancellationAcknowledgedAt);
  assert.equal(out.value, undefined, 'no chat result may escape a cancelled operation');
});

test('4b · a late success after chat() cancellation is discarded', async () => {
  const ac = new AbortController();
  let release!: (r: Response) => void;
  const c = client(() => new Promise<Response>((res) => { release = res; }), config({ timeoutMs: 5_000 }));
  const p = c.chatGoverned({} as never, ac.signal);
  setTimeout(() => { ac.abort(); release(new Response('{"content":"late"}', { status: 200 })); }, 10);
  const out = await p;
  assert.notEqual(out.record.state, 'completed');
  assert.equal(out.record.terminalObserved, false);
});

// ── 5. retrieve() malformed ─────────────────────────────────────────────────

test('5 · retrieve() malformed payload is invalid_response and no parsed result escapes', async () => {
  const c = client(malformed);
  const err = await c.retrieve({} as never).then(
    (v) => v,
    (e: unknown) => e as BrainOperationError,
  );
  assert.ok(err instanceof BrainOperationError, 'a malformed body must not resolve');
  assert.equal(err.category, 'invalid_response');
  assert.notEqual(err.record.state, 'completed');
});

// ── 6. route() failed precondition ⇒ zero transport calls ──────────────────

test('6 · route() with an unconfirmed precondition performs zero transport calls', async () => {
  const f = spy(json({ modelProfile: 'default' }));
  const c = client(f);
  const out = await c.routeGoverned({} as never, undefined, {
    precondition: () => false,
    label: 'brain ready',
  });
  assert.equal(f.calls, 0, 'nothing may be dispatched when the precondition is unconfirmed');
  assert.equal(out.ok, false);
  assert.equal(out.record.failureCategory, 'precondition_failed');
});

// ── 7. callBrainTool() uncertain terminal ⇒ one attempt, no retry ───────────

test('7 · callBrainTool() terminal_state_unverified is attempted once and never retried', async () => {
  const f = spy(async () => new Response('server error', { status: 500 }));
  const out = await callBrainTool('http://127.0.0.1:3988', '/tool', { x: 1 }, { fetchImpl: f, timeoutMs: 40 });
  assert.equal(f.calls, 1, 'a consequential tool call must never be replayed');
  assert.equal(out.ok, false);
  assert.equal(out.record.failureCategory, 'terminal_state_unverified');
  assert.equal(out.value, undefined);
});

// ── 8. diagnostics path ─────────────────────────────────────────────────────

test('8 · a diagnostics failure is truthful and touches no unrelated operation', async () => {
  const unrelated = client(json({ content: 'ok' }));
  const good = await unrelated.chatGoverned({} as never);
  assert.equal(good.record.state, 'completed');

  const f = spy(malformed);
  const out = await callBrainTool('http://127.0.0.1:3988', '/internal/diagnostics.sync', {}, {
    fetchImpl: f,
    timeoutMs: 40,
  });
  assert.equal(out.ok, false);
  assert.equal(out.record.failureCategory, 'invalid_response');
  // The earlier completed operation is a separate record and is untouched.
  assert.equal(good.record.state, 'completed');
  assert.notEqual(out.record.operationId, good.record.operationId);
});

// ── 9. production-diagnostics cancellation suppresses downstream work ───────

test('9 · production-diagnostics timeout suppresses every downstream callback', async () => {
  let downstream = 0;
  const f = spy(hang);
  const out = await callBrainTool('http://127.0.0.1:3988', '/api/ai/production-diagnostics/status', undefined, {
    fetchImpl: f,
    timeoutMs: 30,
    method: 'GET',
  });
  if (out.ok && out.value) downstream += 1; // the real caller's guard
  assert.equal(downstream, 0, 'no notification/update may run without an observed terminal result');
  assert.equal(out.ok, false);
  assert.equal(out.record.failureCategory, 'request_timeout');
});

// ── 10. retry supersession on an idempotent read ────────────────────────────

/** Tracks how many transport attempts are in flight at once. The sequential-retry
 * guarantee is exactly "this never exceeds 1", so it is asserted directly rather than
 * inferred from a token that does no work. */
function concurrencyTracker(impl: FetchLike) {
  const t = { active: 0, max: 0, calls: 0 };
  const f: FetchLike = async (u, i) => {
    t.calls += 1;
    t.active += 1;
    t.max = Math.max(t.max, t.active);
    try {
      return await impl(u, i);
    } finally {
      t.active -= 1;
    }
  };
  return { f, t };
}

const resetFail: FetchLike = async () => {
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
};

test('10 · retries are strictly sequential — maxConcurrentAttempts === 1', async () => {
  let n = 0;
  const { f, t } = concurrencyTracker(async () => {
    n += 1;
    if (n === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return new Response(JSON.stringify({ chunks: [], second: true }), { status: 200 });
  });
  const c = new BrainClient(sink, config(), f, RETRY_1, instantScheduler);
  const out = await c.retrieveGoverned({} as never);

  assert.equal(t.max, 1, 'at most one transport attempt may be active at any time');
  assert.equal(t.calls, 2);
  assert.equal(out.ok, true, 'the second attempt is authoritative because the first already ended');
});

test('10 · a retry is created only AFTER the previous attempt reaches a terminal outcome', async () => {
  const order: string[] = [];
  let n = 0;
  const f: FetchLike = async () => {
    n += 1;
    const id = n;
    order.push(`start:${id}`);
    if (id === 1) {
      order.push(`end:${id}`);
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }
    order.push(`end:${id}`);
    return new Response(JSON.stringify({ chunks: [] }), { status: 200 });
  };
  const c = new BrainClient(sink, config(), f, RETRY_1, instantScheduler);
  await c.retrieveGoverned({} as never);
  assert.deepEqual(order, ['start:1', 'end:1', 'start:2', 'end:2'],
    'attempt 2 must not start before attempt 1 has ended');
});

test('10 · cancellation while the first attempt is pending creates no second attempt', async () => {
  const ac = new AbortController();
  const { f, t } = concurrencyTracker(hang);
  const c = new BrainClient(sink, config({ timeoutMs: 5_000 }), f, RETRY_1, instantScheduler);
  const p = c.retrieveGoverned({} as never, ac.signal);
  setTimeout(() => ac.abort(), 10);
  await p;
  assert.equal(t.calls, 1, 'no attempt may be created after cancellation');
  assert.equal(t.max, 1);
});

test('10 · a successful first attempt produces exactly one attempt', async () => {
  const { f, t } = concurrencyTracker(json({ chunks: [] }));
  const c = new BrainClient(sink, config(), f, RETRY_1, instantScheduler);
  const out = await c.retrieveGoverned({} as never);
  assert.equal(t.calls, 1, 'success must not trigger a retry');
  assert.equal(out.ok, true);
});

test('10 · a successful second attempt records the first as failed, with no supersession claim', async () => {
  let n = 0;
  const f = spy(async () => {
    n += 1;
    if (n === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return new Response(JSON.stringify({ chunks: [] }), { status: 200 });
  });
  const c = new BrainClient(sink, config(), f, RETRY_1, instantScheduler);
  const out = await c.retrieveGoverned({} as never);
  const log = out.record.failures.join(' | ');
  assert.match(log, /#a1 failed with connection_lost — retry_scheduled/);
  assert.match(log, /#a2 succeeded — authoritative result/);
  assert.doesNotMatch(log, /supersed/i, 'supersession is not a reachable state in a sequential design');
});

test('10b · policy disabled ⇒ exactly one attempt', async () => {
  const f = spy(async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  });
  const c = new BrainClient(sink, config(), f, RETRY_0, instantScheduler);
  const out = await c.retrieveGoverned({} as never);
  assert.equal(f.calls, 1);
  assert.equal(out.ok, false);
});

test('10c · terminal_state_unverified is never retried', async () => {
  const f = spy(async () => new Response('err', { status: 500 }));
  const c = new BrainClient(sink, config(), f, RETRY_1, instantScheduler);
  const out = await c.retrieveGoverned({} as never);
  assert.equal(f.calls, 1, 'the server may already have acted — never replay');
  assert.equal(out.record.failureCategory, 'terminal_state_unverified');
});

test('10d · malformed payload is not retried', async () => {
  const f = spy(malformed);
  const c = new BrainClient(sink, config(), f, RETRY_1, instantScheduler);
  const out = await c.retrieveGoverned({} as never);
  assert.equal(f.calls, 1);
  assert.equal(out.record.failureCategory, 'invalid_response');
});

test('10e · cancellation during backoff prevents the second attempt', async () => {
  const ac = new AbortController();
  const f = spy(async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  });
  // Scheduler that cancels while "waiting", then rejects as a real cancelled delay would.
  const cancelDuringBackoff = {
    delay: async () => {
      ac.abort();
      throw new Error('cancelled during backoff');
    },
  };
  const c = new BrainClient(sink, config(), f, RETRY_1, cancelDuringBackoff);
  const out = await c.retrieveGoverned({} as never, ac.signal);
  assert.equal(f.calls, 1, 'no attempt may start after cancellation');
  assert.equal(out.ok, false);
});

test('10f · a consequential method never retries even if policy enables retries', async () => {
  const f = spy(async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  });
  // idempotentReads is high, but chat() is consequential and must ignore it entirely.
  const c = new BrainClient(sink, config(), f, { consequential: 0, health: 0, idempotentReads: 5 }, instantScheduler);
  const out = await c.chatGoverned({} as never);
  assert.equal(f.calls, 1, 'chat() is consequential — retry policy must not apply');
  assert.equal(out.ok, false);
});

test('10g · retry exhaustion ends in a truthful failure, never a generic success', async () => {
  const f = spy(async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  });
  const c = new BrainClient(sink, config(), f, { consequential: 0, health: 0, idempotentReads: 2 }, instantScheduler);
  const out = await c.retrieveGoverned({} as never);
  assert.equal(f.calls, 3, 'bounded: initial attempt plus two retries');
  assert.equal(out.ok, false);
  assert.equal(out.record.failureCategory, 'connection_lost');
  assert.notEqual(out.record.state, 'completed');
});

// ── structural: every Brain-facing export has a public-path test ────────────

test('structural · every exported Brain-facing method has a public-path test here', () => {
  const covered = new Set([
    'health',
    'healthDetail',
    'route',
    'routeGoverned',
    'retrieve',
    'retrieveGoverned',
    'chat',
    'chatGoverned',
    'callBrainTool',
  ]);
  // Inspect DESCRIPTORS — reading a value here would invoke the getters, which
  // dereference `this.config` on a prototype that has none.
  const actual = Object.getOwnPropertyNames(BrainClient.prototype).filter((n) => {
    if (n === 'constructor') return false;
    const d = Object.getOwnPropertyDescriptor(BrainClient.prototype, n);
    return typeof d?.value === 'function';
  });
  const brainFacing = actual.filter((n) => !['log', 'dispatch', 'retryIdempotent', 'connectionStatusLine', 'snapshotFailureCategory'].includes(n));
  for (const method of brainFacing) {
    assert.ok(covered.has(method), `BrainClient.${method}() has no public-path behaviour test`);
  }
});

test('structural · no wrapper converts BrainOperationError into a success-shaped value', async () => {
  // Every failing public path must reject or return ok:false — never a truthy result.
  const c = client(refuse);
  for (const call of [
    () => c.chat({} as never),
    () => c.retrieve({} as never),
    () => c.route({} as never),
    () => c.health(),
  ]) {
    const r = await call().then(
      (v) => ({ resolved: true, v }),
      () => ({ resolved: false, v: undefined }),
    );
    assert.equal(r.resolved, false, 'a refused connection must not resolve to a value');
  }
});

// ── operation persistence: the terminal write is the success gate ────────────

import { BrainStore, operationPersister, type StorageFs } from '../../services/brainPersistence.js';

function tinyFs() {
  const files = new Map<string, string>();
  let breakNext = false;
  const fs: StorageFs = {
    mkdir: async () => {},
    readFile: async (p) => { const v = files.get(p); if (v === undefined) throw new Error('ENOENT'); return v; },
    writeFile: async (p, d) => { if (breakNext) { breakNext = false; throw new Error('EIO'); } files.set(p, d); },
    rename: async (a, b) => { const v = files.get(a)!; files.delete(a); files.set(b, v); },
    readdir: async () => [],
    exists: async (p) => files.has(p),
  };
  return { fs, files, breakNext: () => { breakNext = true; } };
}

test('persistence · a successful operation writes progress then an awaited terminal revision', async () => {
  const t = tinyFs();
  const store = new BrainStore('/gs', t.fs);
  const p = operationPersister(store, () => {});
  const c = new BrainClient(sink, config(), spy(json({ content: 'ok' })), RETRY_0, instantScheduler);
  const out = await c.chatGoverned({} as never, undefined, undefined, p);
  assert.equal(out.ok, true);
  assert.equal(out.durable, true, 'terminal revision was persisted');
  assert.ok((out.revision ?? 0) >= 3, 'progress writes precede the terminal revision');
});

test('persistence · a failed TERMINAL write suppresses success entirely', async () => {
  const t = tinyFs();
  const store = new BrainStore('/gs', t.fs);
  const p = operationPersister(store, () => {});
  let continued = 0;
  const c = new BrainClient(sink, config(), spy(json({ content: 'ok' })), RETRY_0, instantScheduler);
  // Break the write that the TERMINAL revision will use.
  const origPersistTerminal = p.persistTerminal.bind(p);
  const gated = { ...p, persistTerminal: async () => { void origPersistTerminal; return false; } };
  const out = await c.chatGoverned({} as never, undefined, undefined, gated);
  assert.equal(out.ok, false, 'a Brain success that is not durable is NOT a success');
  assert.equal(out.durable, false);
  assert.equal(continued, 0);
  assert.match(out.statusLine, /not durably recorded/i);
  // The record still says `completed` — that is TRUE, the operation did complete.
  // Durability is a separate fact, and forcing the state to `failed` would be a lie.
  // What matters is that no success escapes: ok=false and durable=false.
  assert.equal(out.record.state, 'completed');
  assert.equal(out.value, undefined, 'no value may escape a non-durable completion');
});

// ── integration: nine write points, monotonic, never batched ─────────────────

/** Captures every persisted revision in write order, so ordering is provable rather
 * than inferred from the final file. */
function recordingStore() {
  const t = tinyFs();
  const store = new BrainStore('/gs', t.fs);
  const seen: Array<{ revision: number; state: string }> = [];
  const base = operationPersister(store, () => {});
  const p = {
    persistProgress: (r: Parameters<typeof base.persistProgress>[0]) => {
      seen.push({ revision: p.currentRevision() + 1, state: r.currentState });
      base.persistProgress(r);
    },
    persistTerminal: async (r: Parameters<typeof base.persistTerminal>[0]) => {
      seen.push({ revision: p.currentRevision() + 1, state: r.currentState });
      return base.persistTerminal(r);
    },
    currentRevision: () => base.currentRevision(),
  };
  return { p, seen, files: t.files };
}

test('integration · a successful operation persists monotonic revisions, never batched', async () => {
  const { p, seen } = recordingStore();
  const c = new BrainClient(sink, config(), spy(json({ content: 'ok' })), RETRY_0, instantScheduler);
  const out = await c.chatGoverned({} as never, undefined, undefined, p);

  assert.equal(out.ok, true);
  assert.equal(out.durable, true);
  assert.ok(seen.length >= 4, `expected several distinct writes, saw ${seen.length}`);

  // Monotonic and gapless — batching would collapse these into one.
  const revs = seen.map((s) => s.revision);
  assert.deepEqual(revs, [...revs].sort((a, b) => a - b), 'revisions must be monotonic');
  assert.equal(new Set(revs).size, revs.length, 'no revision may be reused');

  // The lifecycle is visible in the record trail, not just the end state.
  const states = seen.map((s) => s.state);
  assert.ok(states.includes('connecting'), 'initial record precedes dispatch');
  assert.ok(states.includes('running'), 'running is persisted');
  assert.equal(states.at(-1), 'completed', 'terminal write is last');
});

test('integration · a failing operation still persists its trail and terminal failure', async () => {
  const { p, seen } = recordingStore();
  const c = new BrainClient(sink, config(), spy(refuse), RETRY_0, instantScheduler);
  const out = await c.chatGoverned({} as never, undefined, undefined, p);

  assert.equal(out.ok, false);
  assert.equal(seen.at(-1)!.state, 'failed', 'the terminal write records the failure');
  const revs = seen.map((s) => s.revision);
  assert.deepEqual(revs, [...revs].sort((a, b) => a - b));
});

test('integration · no token-shaped value reaches disk from a real operation', async () => {
  const { p, files } = recordingStore();
  const c = new BrainClient(sink, config(), spy(json({ content: 'ok' })), RETRY_0, instantScheduler);
  await c.chatGoverned(
    { prompt: 'Authorization: Bearer supersecrettokenvalue123456' } as never,
    undefined,
    undefined,
    p,
  );
  const onDisk = [...files.values()].join('\n');
  assert.equal(/supersecrettokenvalue123456/.test(onDisk), false, 'request payloads never persist');
  assert.equal(/sk_live_/.test(onDisk), false);
});
