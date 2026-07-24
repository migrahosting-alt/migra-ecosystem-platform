import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAiRoutes } from '../src/engine/aiRoutes.js';
import { auditStore } from '../src/engine/auditLog.js';

const STUB_ENV = {
  localProvider: 'stub',
  providerBaseUrl: 'http://127.0.0.1:1/v1',
  openAiApiKey: undefined,
} as never;

let app: FastifyInstance;
let baseUrl = '';
let originalFetch: typeof fetch;
const externalAttempts: string[] = [];

before(async () => {
  app = Fastify({ logger: false });
  registerAiRoutes(app, STUB_ENV);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;

  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== baseUrl) {
      externalAttempts.push(url.toString());
      return Promise.reject(new Error(`External network denied by local-foundation test: ${url.origin}`));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
});

function frames(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  return text
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const raw = /^data: (.+)$/m.exec(block)?.[1];
      return event && raw ? { event, data: JSON.parse(raw) as Record<string, unknown> } : null;
    })
    .filter((value): value is { event: string; data: Record<string, unknown> } => value !== null);
}

test('deterministic local foundation streams multiple chunks with one correlated audit chain and no tools/network', async () => {
  const requestId = 'foundation-complete-1';
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-request-id': requestId },
    body: JSON.stringify({ prompt: 'enterprise foundation', stream: true, needsTools: false }),
  });
  assert.equal(response.status, 200);
  const trace = frames(await response.text());
  const tokens = trace.filter((event) => event.event === 'token').map((event) => String(event.data.text ?? ''));

  assert.ok(tokens.length >= 3, `expected progressive chunks, received ${tokens.length}`);
  assert.equal(
    tokens.join(''),
    'Stub provider response for profile: default. Feature: chat. Wire a real model provider here next.',
  );
  assert.equal(trace[0]?.event, 'route');
  assert.equal(trace.at(-1)?.event, 'done');
  assert.equal(trace[0]?.data.requestId, requestId);
  assert.equal(trace.at(-1)?.data.requestId, requestId);

  const audit = auditStore.byCorrelation(requestId);
  assert.deepEqual(audit.map((record) => record.type), [
    'execution.started',
    'execution.routed',
    'execution.completed',
  ]);
  assert.ok(audit.every((record) => record.component === 'chat' && record.requestId === requestId));
  assert.equal(audit.some((record) => record.type.startsWith('tool.')), false);
  assert.equal(audit.at(-1)?.fields.toolCalls, 0);
  assert.deepEqual(externalAttempts, []);
});

test('cancellation stops deterministic generation without done or tool execution', async () => {
  const requestId = 'foundation-cancel-1';
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-request-id': requestId },
    body: JSON.stringify({ prompt: 'cancel this foundation turn', stream: true, needsTools: false }),
    signal: controller.signal,
  });
  assert.ok(response.body);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let observed = '';
  while (!observed.includes('event: token')) {
    const next = await reader.read();
    if (next.done) break;
    observed += decoder.decode(next.value, { stream: true });
  }
  assert.match(observed, /event: token/);
  controller.abort();
  await assert.rejects(() => reader.read(), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  assert.doesNotMatch(observed, /event: done/);
  const audit = auditStore.byCorrelation(requestId);
  assert.equal(audit.at(-1)?.type, 'execution.failed');
  assert.equal(audit.at(-1)?.outcome, 'cancelled');
  assert.equal(audit.some((record) => record.type.startsWith('tool.')), false);
  assert.equal(audit.at(-1)?.fields.toolCalls, 0);
  assert.deepEqual(externalAttempts, []);
});
