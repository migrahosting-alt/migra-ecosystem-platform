import assert from 'node:assert/strict';
import test from 'node:test';
import { PilotApiClient, type PilotApiConfig } from '@migrapilot/pilot-client';
import { PilotError } from '@migrapilot/pilot-client';
import { type CapabilityMode, type MockPilotApi, startMockPilotApi } from '../support/mockPilotApi.js';

function configFor(url: string, over: { token?: string; authMode?: 'bearer' | 'none'; timeoutMs?: number } = {}): PilotApiConfig {
  // Distinguish an explicit `token: undefined` (no token) from an omitted token.
  const token = 'token' in over ? over.token : 'test-jwt';
  return {
    baseUrl: () => url,
    token: () => token,
    authMode: () => over.authMode ?? 'bearer',
    timeoutMs: () => over.timeoutMs ?? 2000,
    log: () => {},
  };
}

async function withMock(
  opts: Parameters<typeof startMockPilotApi>[0],
  fn: (mock: MockPilotApi) => Promise<void>,
): Promise<void> {
  const mock = await startMockPilotApi(opts);
  try {
    await fn(mock);
  } finally {
    await mock.close();
  }
}

test('capabilities: ok → ready with real caps', async () => {
  await withMock({ capabilities: 'ok' }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url));
    const state = await client.negotiateCapabilities();
    assert.equal(state.status, 'ready');
    if (state.status === 'ready') {
      assert.equal(state.caps.streaming, true);
      assert.equal(state.caps.chatTransport, 'sse');
      assert.equal(state.caps.rejectResumeReplay.resume, true);
    }
  });
});

test('capabilities: missing (404) → degraded/missing with conservative caps', async () => {
  await withMock({ capabilities: 'missing' as CapabilityMode }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url));
    const state = await client.negotiateCapabilities();
    assert.equal(state.status, 'degraded');
    if (state.status === 'degraded') {
      assert.equal(state.reason, 'missing');
      assert.equal(state.caps.streaming, false);
      assert.equal(state.caps.approvals, false);
    }
  });
});

test('capabilities: malformed → degraded/malformed (body not partially trusted)', async () => {
  await withMock({ capabilities: 'malformed' }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url));
    const state = await client.negotiateCapabilities();
    assert.equal(state.status, 'degraded');
    if (state.status === 'degraded') {
      assert.equal(state.reason, 'malformed');
    }
  });
});

test('capabilities: incompatible protocolVersion → incompatible', async () => {
  await withMock({ capabilities: 'incompatible' }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url));
    const state = await client.negotiateCapabilities();
    assert.equal(state.status, 'incompatible');
    if (state.status === 'incompatible') {
      assert.equal(state.observedProtocolVersion, 2);
    }
  });
});

test('capabilities: unauthorized (401) → unauthorized state, no stub fallback', async () => {
  await withMock({ capabilities: 'unauthorized' }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url));
    const state = await client.negotiateCapabilities();
    assert.equal(state.status, 'unauthorized');
  });
});

test('request sends Authorization: Bearer and X-Request-Id headers', async () => {
  await withMock({ capabilities: 'ok' }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url, { token: 'secret-123' }));
    await client.negotiateCapabilities();
    const capReq = mock.requests.find((r) => r.path === '/api/pilot/v1/capabilities');
    assert.ok(capReq, 'capabilities request recorded');
    assert.equal(capReq.headers['authorization'], 'Bearer secret-123');
    assert.match(String(capReq.headers['x-request-id']), /[0-9a-f-]{36}/i);
  });
});

test('ready(): anonymous health, no Authorization header', async () => {
  await withMock({}, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url));
    assert.equal(await client.ready(), true);
    const healthReq = mock.requests.find((r) => r.path === '/health/ready');
    assert.ok(healthReq);
    assert.equal(healthReq.headers['authorization'], undefined);
  });
});

test('ready(): 503 not-ready → false', async () => {
  await withMock({ notReady: true }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url));
    assert.equal(await client.ready(), false);
  });
});

test('timeout → PilotError TIMEOUT', async () => {
  await withMock({ capabilities: 'ok', delayMs: 300 }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url, { timeoutMs: 50 }));
    await assert.rejects(
      () => client.request('GET', '/api/pilot/v1/capabilities'),
      (err: unknown) => err instanceof PilotError && err.code === 'TIMEOUT',
    );
  });
});

test('chatStream yields ordered SSE events ending in completed', async () => {
  await withMock({ capabilities: 'ok' }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url));
    const events: string[] = [];
    let completed: unknown;
    for await (const ev of client.chatStream({ message: 'hi' })) {
      events.push(ev.event);
      if (ev.event === 'completed') {
        completed = ev.data;
      }
    }
    assert.deepEqual(events, ['conversation', 'plan', 'token', 'token', 'completed']);
    assert.equal((completed as { status?: string }).status, 'completed');
  });
});

test('no silent fallback: 401 on a request throws AUTH_REQUIRED (never stub output)', async () => {
  await withMock({ requireAuth: true }, async (mock) => {
    const client = new PilotApiClient(configFor(mock.url, { token: undefined }));
    await assert.rejects(
      () => client.request('GET', '/api/pilot/pending-actions'),
      (err: unknown) => err instanceof PilotError && err.code === 'AUTH_REQUIRED',
    );
  });
});
