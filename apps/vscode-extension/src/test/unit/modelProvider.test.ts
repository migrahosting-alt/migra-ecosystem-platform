import assert from 'node:assert/strict';
import test from 'node:test';
import { type ModelProvider, type ProviderChunk, type ProviderRequest } from '../../providers/modelProvider.js';
import { type OpenAiCompatConfig, OpenAiCompatProvider } from '../../providers/openAiCompatProvider.js';
import { collectCompletion, createProvider } from '../../providers/providerFactory.js';
import { StubModelProvider } from '../../providers/stubProvider.js';
import { PilotError } from '@migrapilot/pilot-client';
import { type MockModelProvider, startMockModelProvider } from '../support/mockModelProvider.js';

const REQ: ProviderRequest = { messages: [{ role: 'user', content: 'hi' }], requestId: 'req-p-1' };

async function drain(gen: AsyncGenerator<ProviderChunk>): Promise<ProviderChunk[]> {
  const out: ProviderChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

function providerFor(url: string, key: string | undefined = 'sk-test'): OpenAiCompatProvider {
  const cfg: OpenAiCompatConfig = {
    baseUrl: () => url,
    apiKey: () => key,
    model: () => 'test-model',
    timeoutMs: () => 2000,
    log: () => {},
  };
  return new OpenAiCompatProvider(cfg);
}

async function withMock(
  opts: Parameters<typeof startMockModelProvider>[0],
  fn: (m: MockModelProvider) => Promise<void>,
): Promise<void> {
  const m = await startMockModelProvider(opts);
  try {
    await fn(m);
  } finally {
    await m.close();
  }
}

// ── stub provider ────────────────────────────────────────────────────────────

test('stub provider streams deterministic tokens + usage + done', async () => {
  const chunks = await drain(new StubModelProvider().stream(REQ));
  assert.ok(chunks.some((c) => c.type === 'token'));
  assert.ok(chunks.some((c) => c.type === 'usage'));
  assert.equal(chunks.at(-1)?.type, 'done');
});

test('stub provider honors pre-abort → CANCELLED', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => drain(new StubModelProvider().stream(REQ, ac.signal)),
    (e: unknown) => e instanceof PilotError && e.code === 'CANCELLED',
  );
});

test('stub provider capabilities report identity, not credentials', () => {
  const caps = new StubModelProvider().capabilities();
  assert.equal(caps.providerId, 'stub');
  assert.equal(caps.streaming, true);
});

// ── openai-compat provider vs mock ───────────────────────────────────────────

test('real provider streams tokens then usage then done', async () => {
  await withMock({}, async (m) => {
    const chunks = await drain(providerFor(m.url).stream(REQ));
    const text = chunks
      .filter((c): c is Extract<ProviderChunk, { type: 'token' }> => c.type === 'token')
      .map((c) => c.text)
      .join('');
    assert.equal(text, 'Hello world');
    const usage = chunks.find((c) => c.type === 'usage');
    assert.ok(usage && usage.type === 'usage' && usage.usage.totalTokens);
    assert.equal(chunks.at(-1)?.type, 'done');
  });
});

test('real provider sends Authorization + X-Request-Id (correlation), key never omitted when set', async () => {
  await withMock({}, async (m) => {
    await drain(providerFor(m.url, 'sk-secret-123').stream(REQ));
    const req = m.requests[0]!;
    assert.equal(req.headers['authorization'], 'Bearer sk-secret-123');
    assert.equal(req.headers['x-request-id'], 'req-p-1');
  });
});

test('no key → no Authorization header (local server with auth off)', async () => {
  await withMock({}, async (m) => {
    // explicit undefined key (defaulted param would swallow it)
    const p = new OpenAiCompatProvider({
      baseUrl: () => m.url,
      apiKey: () => undefined,
      model: () => 'test-model',
      timeoutMs: () => 2000,
      log: () => {},
    });
    await drain(p.stream(REQ));
    assert.equal(m.requests[0]?.headers['authorization'], undefined);
  });
});

test('rate-limit metadata surfaced on usage without any secret', async () => {
  await withMock({}, async (m) => {
    const chunks = await drain(providerFor(m.url).stream(REQ));
    const usage = chunks.find((c) => c.type === 'usage');
    assert.ok(usage && usage.type === 'usage');
    if (usage.type === 'usage') {
      assert.equal(usage.rateLimit?.remaining, 97);
      assert.equal(usage.rateLimit?.limit, 100);
    }
  });
});

test('401 → AUTH_INVALID', async () => {
  await withMock({ status: 401 }, async (m) => {
    await assert.rejects(
      () => drain(providerFor(m.url).stream(REQ)),
      (e: unknown) => e instanceof PilotError && e.code === 'AUTH_INVALID',
    );
  });
});

test('429 → RATE_LIMITED (retriable)', async () => {
  await withMock({ status: 429 }, async (m) => {
    await assert.rejects(
      () => drain(providerFor(m.url).stream(REQ)),
      (e: unknown) => e instanceof PilotError && e.code === 'RATE_LIMITED' && e.retriable === true,
    );
  });
});

test('500 → SERVER_ERROR', async () => {
  await withMock({ status: 500 }, async (m) => {
    await assert.rejects(
      () => drain(providerFor(m.url).stream(REQ)),
      (e: unknown) => e instanceof PilotError && e.code === 'SERVER_ERROR',
    );
  });
});

test('timeout → TIMEOUT', async () => {
  await withMock({ delayMs: 300 }, async (m) => {
    const p = new OpenAiCompatProvider({
      baseUrl: () => m.url,
      apiKey: () => 'k',
      model: () => 'test-model',
      timeoutMs: () => 40,
      log: () => {},
    });
    await assert.rejects(
      () => drain(p.stream(REQ)),
      (e: unknown) => e instanceof PilotError && e.code === 'TIMEOUT',
    );
  });
});

test('cancellation → CANCELLED', async () => {
  await withMock({}, async (m) => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => drain(providerFor(m.url).stream(REQ, ac.signal)),
      (e: unknown) => e instanceof PilotError && e.code === 'CANCELLED',
    );
  });
});

test('dropped stream → NETWORK (not a false completion)', async () => {
  await withMock({ dropAfter: 1 }, async (m) => {
    await assert.rejects(
      () => drain(providerFor(m.url).stream(REQ)),
      (e: unknown) => e instanceof PilotError && e.code === 'NETWORK',
    );
  });
});

// ── factory: no silent fallback ──────────────────────────────────────────────

test('factory: stub selected → StubModelProvider', () => {
  const p: ModelProvider = createProvider({ kind: 'stub' });
  assert.equal(p.id, 'stub');
});

test('factory: openai-compat without config throws (never silently returns stub)', () => {
  assert.throws(
    () => createProvider({ kind: 'openai-compat' }),
    (e: unknown) => e instanceof PilotError && e.code === 'CAPABILITY_MISSING',
  );
});

test('collectCompletion: real provider failure propagates, never yields stub text', async () => {
  await withMock({ status: 500 }, async (m) => {
    const p = createProvider({
      kind: 'openai-compat',
      openAi: { baseUrl: () => m.url, apiKey: () => 'k', model: () => 'm', timeoutMs: () => 2000, log: () => {} },
    });
    await assert.rejects(
      () => collectCompletion(p, REQ),
      (e: unknown) => e instanceof PilotError && e.code === 'SERVER_ERROR',
    );
  });
});

test('collectCompletion returns buffered content + provider identity', async () => {
  await withMock({}, async (m) => {
    const p = providerFor(m.url);
    const result = await collectCompletion(p, REQ);
    assert.equal(result.content, 'Hello world');
    assert.equal(result.providerId, 'openai-compat');
    assert.equal(result.model, 'test-model');
  });
});
