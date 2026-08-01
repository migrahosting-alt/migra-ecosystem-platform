import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrainAbortReason,
  classifyTransportFailure,
  runBrainOperation,
  type FetchLike,
} from '../../services/brainTransport.js';

/**
 * Transport-level truthfulness tests.
 *
 * The transport is instrumented so assertions prove the destructive call was never
 * INVOKED — not merely that the final label looked right. A label can be correct
 * while the damage has already been done; that is exactly the failure this slice
 * exists to prevent.
 */

/** Counts invocations so "zero fetches" is provable. */
function spyFetch(impl: FetchLike): FetchLike & { calls: number } {
  const f = (async (url: string, init: RequestInit) => {
    (f as unknown as { calls: number }).calls += 1;
    return impl(url, init);
  }) as FetchLike & { calls: number };
  f.calls = 0;
  return f;
}

const jsonOk = (body: unknown): FetchLike => async () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const base = { operationId: 'op-1', endpoint: 'http://127.0.0.1:3988/chat', timeoutMs: 50 };

// ── 1. timeout maps to request_timeout, not cancelled ───────────────────────

test('1 · a timeout maps to request_timeout and never to cancelled', async () => {
  const fetchImpl = spyFetch(
    (_u, init) =>
      new Promise((_res, rej) => {
        (init.signal as AbortSignal).addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  );
  const out = await runBrainOperation({ ...base, requestedAction: 'chat', fetchImpl });
  assert.equal(out.ok, false);
  assert.equal(out.record.failureCategory, 'request_timeout');
  assert.notEqual(out.record.state, 'cancelled');
  assert.notEqual(out.record.state, 'completed');
});

// ── 2/3. user abort: confirmed only when the transport is conclusively dead ──

test('2 · user cancellation with a dead transport resolves to cancelled', async () => {
  const external = new AbortController();
  const fetchImpl = spyFetch(
    (_u, init) =>
      new Promise((_res, rej) => {
        (init.signal as AbortSignal).addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  );
  const p = runBrainOperation({
    ...base,
    timeoutMs: 5_000,
    requestedAction: 'chat',
    fetchImpl,
    externalSignal: external.signal,
  });
  setTimeout(() => external.abort(), 10);
  const out = await p;
  assert.equal(out.ok, false);
  assert.equal(out.record.state, 'cancelled');
  assert.ok(out.record.cancellationAcknowledgedAt, 'acknowledgement must be recorded');
  assert.doesNotMatch(out.statusLine, /Completed/);
});

test('3 · an unacknowledged cancellation stays cancellation_unconfirmed, not cancelled', () => {
  const c = classifyTransportFailure({ cancellationUnacknowledged: true });
  assert.equal(c.category, 'cancellation_unconfirmed');
});

// ── 4. connection refusal and malformed response are distinct ───────────────

test('4 · connection refusal and malformed response classify differently', async () => {
  const refused = await runBrainOperation({
    ...base,
    requestedAction: 'chat',
    fetchImpl: spyFetch(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }),
  });
  assert.equal(refused.record.failureCategory, 'connection_refused');

  const malformed = await runBrainOperation({
    ...base,
    requestedAction: 'chat',
    fetchImpl: spyFetch(async () => new Response('not json{', { status: 200 })),
  });
  assert.equal(malformed.record.failureCategory, 'invalid_response');

  assert.notEqual(refused.record.failureCategory, malformed.record.failureCategory);
});

test('4b · connect-phase and mid-stream codes are distinguished', () => {
  assert.equal(classifyTransportFailure({ cause: { code: 'ECONNREFUSED' } }).category, 'connection_refused');
  assert.equal(classifyTransportFailure({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }).category, 'connection_refused');
  assert.equal(classifyTransportFailure({ cause: { code: 'ECONNRESET' } }).category, 'connection_lost');
  assert.equal(classifyTransportFailure({ cause: { code: 'UND_ERR_SOCKET' } }).category, 'connection_lost');
  assert.equal(classifyTransportFailure({ processExited: true }).category, 'brain_process_exit');
});

test('4c · insufficient evidence classifies conservatively and preserves the raw diagnostic', () => {
  const c = classifyTransportFailure({ cause: { message: 'something opaque' } });
  assert.equal(c.conservative, true);
  assert.equal(c.category, 'terminal_state_unverified');
  assert.match(c.diagnostic, /something opaque/);
  // Never optimistic under uncertainty.
  assert.notEqual(c.category as string, 'completed');
});

// ── 5. late success after cancellation cannot invoke continuations ──────────

test('5 · a late success after cancellation never invokes the continuation callback', async () => {
  const external = new AbortController();
  let continuationCalls = 0;
  let release!: (r: Response) => void;
  const fetchImpl = spyFetch(() => new Promise<Response>((res) => { release = res; }));

  const p = runBrainOperation<{ ok: boolean }>({
    ...base,
    timeoutMs: 5_000,
    requestedAction: 'chat',
    fetchImpl,
    externalSignal: external.signal,
    onTerminal: () => { continuationCalls += 1; },
  });

  setTimeout(() => {
    external.abort();
    // The response arrives AFTER cancellation was requested.
    release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }, 10);

  const out = await p;
  assert.equal(continuationCalls, 0, 'continuation must never run after cancellation');
  assert.equal(out.ok, false);
  assert.notEqual(out.record.state, 'completed');
  assert.equal(out.record.terminalObserved, false);
});

// ── 6. failed precondition ⇒ ZERO fetches ──────────────────────────────────

test('6 · a failed precondition performs zero fetches and reports precondition_failed', async () => {
  const fetchImpl = spyFetch(jsonOk({ ok: true }));
  const out = await runBrainOperation({
    ...base,
    requestedAction: 'merge',
    fetchImpl,
    precondition: () => false,
    preconditionLabel: 'unresolved review thread exists',
  });
  assert.equal(fetchImpl.calls, 0, 'the destructive request must never be dispatched');
  assert.equal(out.ok, false);
  assert.equal(out.record.failureCategory, 'precondition_failed');
  assert.notEqual(out.record.state, 'completed');
  assert.doesNotMatch(out.statusLine, /Completed|success/i);
});

test('6b · a precondition that THROWS is treated as unconfirmed, not as satisfied', async () => {
  const fetchImpl = spyFetch(jsonOk({ ok: true }));
  const out = await runBrainOperation({
    ...base,
    requestedAction: 'merge',
    fetchImpl,
    precondition: () => { throw new Error('HTTP 422 Line could not be resolved'); },
  });
  assert.equal(fetchImpl.calls, 0);
  assert.equal(out.record.failureCategory, 'precondition_failed');
});

// ── 7. queued continuation must not start after cancellation ───────────────

test('7 · a queued second action never starts after the first is cancelled', async () => {
  const external = new AbortController();
  let secondStarted = 0;
  let release!: (r: Response) => void;
  const first = spyFetch(() => new Promise<Response>((res) => { release = res; }));

  const p = runBrainOperation<{ ok: boolean }>({
    ...base,
    timeoutMs: 5_000,
    requestedAction: 'first',
    fetchImpl: first,
    externalSignal: external.signal,
    onTerminal: () => { secondStarted += 1; },
  });

  setTimeout(() => { external.abort(); release(new Response('{"ok":true}', { status: 200 })); }, 10);
  const out = await p;

  assert.equal(secondStarted, 0, 'the queued continuation must not be reached');
  assert.notEqual(out.record.state, 'completed');
});

// ── happy path still works ─────────────────────────────────────────────────

test('a genuine terminal response completes and invokes the continuation exactly once', async () => {
  let calls = 0;
  const out = await runBrainOperation<{ answer: string }>({
    ...base,
    requestedAction: 'chat',
    fetchImpl: spyFetch(jsonOk({ answer: '42' })),
    onTerminal: () => { calls += 1; },
  });
  assert.equal(out.ok, true);
  assert.equal(out.value?.answer, '42');
  assert.equal(calls, 1);
  assert.equal(out.record.state, 'completed');
  assert.equal(out.record.terminalObserved, true);
  assert.equal(out.record.invariantViolations.length, 0);
});

test('an HTTP error is never reported as terminal success', async () => {
  const out = await runBrainOperation({
    ...base,
    requestedAction: 'chat',
    fetchImpl: spyFetch(async () => new Response('nope', { status: 503 })),
  });
  assert.equal(out.ok, false);
  assert.equal(out.record.failureCategory, 'terminal_state_unverified');
  assert.notEqual(out.record.state, 'completed');
});

// ── 12. no secrets in the durable record ───────────────────────────────────

test('12 · authorization headers and token-shaped values are absent from the record', async () => {
  const out = await runBrainOperation({
    ...base,
    requestedAction: 'chat',
    body: { prompt: 'hi' },
    fetchImpl: spyFetch(jsonOk({ answer: 'ok' })),
  });
  const serialised = JSON.stringify(out.record);
  for (const forbidden of ['authorization', 'bearer', 'x-api-key', 'sk_live', 'sk_test']) {
    assert.equal(
      serialised.toLowerCase().includes(forbidden),
      false,
      `durable record must not contain ${forbidden}`,
    );
  }
});
