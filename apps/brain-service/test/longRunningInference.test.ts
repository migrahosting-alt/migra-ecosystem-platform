// Long-running inference, against a REAL HTTP provider that is deliberately slow.
//
// A stubbed provider cannot show any of this: the claims are that a generation
// exceeding the OLD 30s and 60s limits completes, that cancellation terminates the
// downstream request rather than only the client's interest in it, and that a
// genuine deadline is reported as a deadline. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as http from 'node:http';
import { OpenAiCompatProvider, ProviderTimeoutError, ProviderAbortedError } from '../src/providers/openAiCompatProvider.js';

/** A provider that takes `delayMs` to answer, and records whether it was aborted. */
function slowProvider(delayMs: number) {
  const state = { requests: 0, aborted: 0, completed: 0 };
  const server = http.createServer((req, res) => {
    state.requests += 1;
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      state.completed += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'done' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }, delayMs);
    // The point of the whole exercise: a cancelled request must reach HERE.
    req.on('aborted', () => { if (!finished) { state.aborted += 1; clearTimeout(timer); } });
    res.on('close', () => { if (!finished) { clearTimeout(timer); } });
  });
  return { server, state };
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');
  return `http://127.0.0.1:${address.port}/v1`;
}

const servers: http.Server[] = [];
after(() => { for (const s of servers) s.close(); });

const REQUEST = {
  prompt: 'hello',
  context: { attachments: [] },
} as never;

test('a generation past the OLD 30s and 60s limits COMPLETES', { timeout: 120000 }, async () => {
  const { server, state } = slowProvider(2_000);
  servers.push(server);
  const baseUrl = await listen(server);
  const provider = new OpenAiCompatProvider({
    profile: 'default', baseUrl, model: 'slow',
    // The shape that used to fail: a connect budget far below the generation time.
    connectTimeoutMs: 500,
    responseTimeoutMs: 60_000,
    absoluteTimeoutMs: 60_000,
  });
  const response = await provider.complete(REQUEST);
  assert.equal(response.content, 'done');
  assert.equal(state.completed, 1);
  // The connect budget must NOT have bounded the generation.
  assert.ok(provider.timeoutPolicy().responseMs > provider.timeoutPolicy().connectMs);
});

test('CANCELLATION terminates the downstream request, not just the client', { timeout: 120000 }, async () => {
  const { server, state } = slowProvider(30_000);
  servers.push(server);
  const baseUrl = await listen(server);
  const provider = new OpenAiCompatProvider({
    profile: 'default', baseUrl, model: 'slow', responseTimeoutMs: 60_000, absoluteTimeoutMs: 60_000,
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const started = Date.now();
  await assert.rejects(
    () => provider.complete(REQUEST, controller.signal),
    (error: Error) => error instanceof ProviderAbortedError,
    'a cancelled generation is ABORTED, never a timeout',
  );
  assert.ok(Date.now() - started < 10_000, 'cancellation returns immediately');
  // Give the server a moment to observe the socket going away.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(state.aborted, 1, 'the provider request itself was aborted — no orphan generation');
  assert.equal(state.completed, 0, 'the work did not run to completion with nobody listening');
});

test('a GENUINE deadline is reported as a timeout, naming the clock', { timeout: 120000 }, async () => {
  const { server } = slowProvider(30_000);
  servers.push(server);
  const baseUrl = await listen(server);
  const provider = new OpenAiCompatProvider({
    profile: 'default', baseUrl, model: 'slow', responseTimeoutMs: 1_000, absoluteTimeoutMs: 1_000,
  });
  await assert.rejects(
    () => provider.complete(REQUEST),
    (error: Error) => {
      assert.ok(error instanceof ProviderTimeoutError, `expected a timeout, got ${error.name}`);
      // `response`, never `connect`: the connection was accepted and the model was
      // still generating. Blaming connect sent operators to look at the network.
      assert.match(error.message, /returned no complete response/);
      return true;
    },
  );
});

test('a SHORT request is unaffected by the long budgets', { timeout: 60000 }, async () => {
  const { server, state } = slowProvider(10);
  servers.push(server);
  const baseUrl = await listen(server);
  const provider = new OpenAiCompatProvider({ profile: 'default', baseUrl, model: 'fast' });
  const started = Date.now();
  const response = await provider.complete(REQUEST);
  assert.equal(response.content, 'done');
  assert.ok(Date.now() - started < 5_000, 'a fast answer stays fast');
  assert.equal(state.completed, 1);
});

test('an ALREADY-cancelled signal never starts the work at all', { timeout: 60000 }, async () => {
  const { server, state } = slowProvider(5_000);
  servers.push(server);
  const baseUrl = await listen(server);
  const provider = new OpenAiCompatProvider({ profile: 'default', baseUrl, model: 'slow' });
  await assert.rejects(() => provider.complete(REQUEST, AbortSignal.abort()));
  assert.equal(state.completed, 0);
});
