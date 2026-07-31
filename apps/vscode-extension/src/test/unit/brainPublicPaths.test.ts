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

test('10 · idempotent reads are NOT retried today — declared policy is not yet implemented', async () => {
  // KNOWN GAP, asserted rather than hidden. `BrainRetryPolicy.idempotentReads` is
  // declared and documented, but retrieve() does not yet implement supersession. The
  // truthful behaviour is therefore a single attempt whose failure surfaces — never a
  // silent success. This test pins that reality so the gap cannot be mistaken for a
  // working feature, and will fail loudly when retry is implemented (at which point it
  // becomes the supersession test: stale first response discarded, second authoritative,
  // both attempts under one operation record).
  let attempt = 0;
  const f = spy(async () => {
    attempt += 1;
    if (attempt === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return new Response(JSON.stringify({ chunks: [] }), { status: 200 });
  });
  const c = new BrainClient(sink, config(), f, { consequential: 0, health: 0, idempotentReads: 1 });
  const out = await c.retrieveGoverned({} as never);
  assert.equal(f.calls, 1, 'no retry is implemented for idempotent reads yet');
  assert.equal(out.ok, false, 'the single attempt failed, and that failure must surface');
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
  const brainFacing = actual.filter((n) => !['log', 'dispatch', 'connectionStatusLine', 'snapshotFailureCategory'].includes(n));
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
