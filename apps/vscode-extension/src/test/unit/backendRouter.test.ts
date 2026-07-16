import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BackendRouter,
  type BackendMode,
  type ChatChunk,
  type LocalChatBackend,
  type RouterChatTurn,
} from '../../services/backendRouter.js';
import { PilotApiClient, type PilotApiConfig } from '@migrapilot/pilot-client';
import { PilotError } from '@migrapilot/pilot-client';
import { InMemoryTokenStore, type TokenStore } from '../../services/tokenStore.js';
import { type CapabilityMode, type MockPilotApi, startMockPilotApi } from '../support/mockPilotApi.js';

const STUB_SENTINEL = 'LOCAL_STUB_OUTPUT';

const stubLocal: LocalChatBackend = {
  chat: async () => ({ content: STUB_SENTINEL }),
};

function pilotFor(url: string, token: string | undefined = 'test-jwt'): PilotApiClient {
  const cfg: PilotApiConfig = {
    baseUrl: () => url,
    token: () => token,
    authMode: () => 'bearer',
    timeoutMs: () => 2000,
    log: () => {},
  };
  return new PilotApiClient(cfg);
}

function turn(): RouterChatTurn {
  return { requestId: 'req-123', local: { prompt: 'hi' }, remote: { message: 'hi' } };
}

async function collect(gen: AsyncGenerator<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of gen) {
    out.push(c);
  }
  return out;
}

async function withMock(
  opts: Parameters<typeof startMockPilotApi>[0],
  fn: (m: MockPilotApi) => Promise<void>,
): Promise<void> {
  const m = await startMockPilotApi(opts);
  try {
    await fn(m);
  } finally {
    await m.close();
  }
}

function router(mode: BackendMode, pilot: PilotApiClient, local: LocalChatBackend = stubLocal): BackendRouter {
  return new BackendRouter({ mode: () => mode, local, pilot, log: () => {} });
}

// ── observational diagnostics hook (must not affect selection) ────────────────

test('onResolution fires with classified info but does not alter selection', async () => {
  await withMock({ capabilities: 'ok' }, async (m) => {
    const events: Array<{ backend: string; reason: string; remoteProbe: string }> = [];
    const withHook = new BackendRouter({
      mode: () => 'remote-pilot',
      local: stubLocal,
      pilot: pilotFor(m.url),
      log: () => {},
      onResolution: (info) => events.push({ backend: info.backend, reason: info.reason, remoteProbe: info.remoteProbe }),
    });
    const resolvedWith = await withHook.resolve();
    const resolvedWithout = await router('remote-pilot', pilotFor(m.url)).resolve();
    assert.deepEqual(resolvedWith.kind, resolvedWithout.kind, 'hook does not change the resolved backend');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.backend, 'remote');
    assert.equal(events[0]?.reason, 'remote-ready');
  });
});

test('a throwing onResolution never breaks resolution', async () => {
  await withMock({ capabilities: 'unauthorized' }, async (m) => {
    const r = new BackendRouter({
      mode: () => 'remote-pilot',
      local: stubLocal,
      pilot: pilotFor(m.url),
      log: () => {},
      onResolution: () => {
        throw new Error('diagnostics listener blew up');
      },
    });
    const resolved = await r.resolve();
    assert.equal(resolved.kind, 'remote-unavailable', 'resolution unaffected by a faulty listener');
  });
});

test('onResolution fires once per re-resolution, reflecting backend change', async () => {
  await withMock({ capabilities: 'ok' }, async (m) => {
    const backends: string[] = [];
    let mode: BackendMode = 'local-brain';
    const r = new BackendRouter({
      mode: () => mode,
      local: stubLocal,
      pilot: pilotFor(m.url),
      log: () => {},
      onResolution: (info) => backends.push(info.backend),
    });
    await r.resolve();
    mode = 'remote-pilot';
    await r.resolve(true); // explicit re-resolution
    assert.deepEqual(backends, ['local', 'remote']);
  });
});

// ── mode resolution ──────────────────────────────────────────────────────────

test('local-brain mode resolves to local without touching pilot', async () => {
  // Unreachable pilot URL; must not be contacted.
  const r = router('local-brain', pilotFor('http://127.0.0.1:1'));
  const resolved = await r.resolve();
  assert.equal(resolved.kind, 'local');
});

test('remote-pilot mode with ready pilot resolves to remote', async () => {
  await withMock({ capabilities: 'ok' }, async (m) => {
    const r = router('remote-pilot', pilotFor(m.url));
    const resolved = await r.resolve();
    assert.equal(resolved.kind, 'remote');
  });
});

test('resolve is computed once and cached (not per request)', async () => {
  await withMock({ capabilities: 'ok' }, async (m) => {
    const r = router('remote-pilot', pilotFor(m.url));
    await r.resolve();
    await r.chat(turn()).next();
    await r.chat(turn()).next();
    const capCalls = m.requests.filter((rq) => rq.path === '/api/pilot/v1/capabilities').length;
    assert.equal(capCalls, 1, 'capabilities negotiated exactly once');
  });
});

// ── auto selection ───────────────────────────────────────────────────────────

test('auto selects remote when pilot is ready', async () => {
  await withMock({ capabilities: 'ok' }, async (m) => {
    const resolved = await router('auto', pilotFor(m.url)).resolve();
    assert.equal(resolved.kind, 'remote');
  });
});

test('auto falls back to local when pilot unreachable', async () => {
  const resolved = await router('auto', pilotFor('http://127.0.0.1:1')).resolve();
  assert.equal(resolved.kind, 'local');
});

for (const mode of ['missing', 'malformed', 'incompatible', 'unauthorized'] as CapabilityMode[]) {
  test(`auto does NOT activate remote when negotiation is ${mode}`, async () => {
    await withMock({ capabilities: mode }, async (m) => {
      const resolved = await router('auto', pilotFor(m.url)).resolve();
      assert.equal(resolved.kind, 'local', `auto must pick local for ${mode}`);
    });
  });
}

// ── remote must not activate on bad negotiation (remote-pilot mode) ───────────

for (const [mode, code] of [
  ['unauthorized', 'AUTH_REQUIRED'],
  ['missing', 'CAPABILITY_MISSING'],
  ['malformed', 'CAPABILITY_MALFORMED'],
  ['incompatible', 'CAPABILITY_INCOMPATIBLE'],
] as Array<[CapabilityMode, string]>) {
  test(`remote-pilot ${mode} → remote-unavailable (${code}), never local`, async () => {
    await withMock({ capabilities: mode }, async (m) => {
      const resolved = await router('remote-pilot', pilotFor(m.url)).resolve();
      assert.equal(resolved.kind, 'remote-unavailable');
      if (resolved.kind === 'remote-unavailable') {
        assert.equal(resolved.error.code, code);
      }
    });
  });
}

// ── no silent fallback ───────────────────────────────────────────────────────

test('remote-pilot failure throws PilotError and NEVER yields stub output', async () => {
  await withMock({ capabilities: 'unauthorized' }, async (m) => {
    const r = router('remote-pilot', pilotFor(m.url));
    await r.resolve();
    await assert.rejects(
      () => collect(r.chat(turn())),
      (err: unknown) => err instanceof PilotError && err.code === 'AUTH_REQUIRED',
    );
  });
});

test('thrown remote error carries the request id', async () => {
  await withMock({ capabilities: 'unauthorized' }, async (m) => {
    const r = router('remote-pilot', pilotFor(m.url));
    await r.resolve();
    await r.chat(turn()).next().then(
      () => assert.fail('expected throw'),
      (err: unknown) => {
        assert.ok(err instanceof PilotError);
        assert.equal((err as PilotError).requestId, 'req-123');
      },
    );
  });
});

// ── routing produces backend-appropriate chunks ──────────────────────────────

test('local routing yields the local message (buffered)', async () => {
  const r = router('local-brain', pilotFor('http://127.0.0.1:1'), {
    chat: async () => ({ content: 'local answer' }),
  });
  const chunks = await collect(r.chat(turn()));
  assert.deepEqual(
    chunks.map((c) => c.type),
    ['message', 'done'],
  );
  const msg = chunks.find((c) => c.type === 'message');
  assert.equal(msg && msg.type === 'message' ? msg.content : '', 'local answer');
});

test('remote routing streams tokens then done', async () => {
  await withMock({ capabilities: 'ok' }, async (m) => {
    const r = router('remote-pilot', pilotFor(m.url));
    await r.resolve();
    const chunks = await collect(r.chat(turn()));
    const tokenText = chunks
      .filter((c): c is Extract<ChatChunk, { type: 'token' }> => c.type === 'token')
      .map((c) => c.text)
      .join('');
    assert.equal(tokenText, 'Hello world');
    assert.equal(chunks.at(-1)?.type, 'done');
  });
});

// ── cancellation propagation ─────────────────────────────────────────────────

test('cancellation propagates through router → SSE (CANCELLED)', async () => {
  await withMock({ capabilities: 'ok', delayMs: 0 }, async (m) => {
    const r = router('remote-pilot', pilotFor(m.url));
    await r.resolve();
    const ac = new AbortController();
    ac.abort(); // pre-aborted → the stream fetch must reject as CANCELLED
    await assert.rejects(
      () => collect(r.chat(turn(), ac.signal)),
      (err: unknown) => err instanceof PilotError && err.code === 'CANCELLED',
    );
  });
});

// ── token store contract (SecretStorage read/write/delete) ───────────────────

test('TokenStore read/write/delete round-trips; absence returns undefined', async () => {
  const store: TokenStore = new InMemoryTokenStore();
  assert.equal(await store.get(), undefined, 'absent → undefined');
  await store.set('jwt-abc');
  assert.equal(await store.get(), 'jwt-abc');
  await store.delete();
  assert.equal(await store.get(), undefined, 'deleted → undefined');
});

test('token absence: pilot call omits Authorization and 401s (no stub)', async () => {
  await withMock({ requireAuth: true }, async (m) => {
    // Explicitly no token (a defaulted param would swallow `undefined`).
    const noTokenPilot = new PilotApiClient({
      baseUrl: () => m.url,
      token: () => undefined,
      authMode: () => 'bearer',
      timeoutMs: () => 2000,
      log: () => {},
    });
    const r = router('remote-pilot', noTokenPilot);
    const resolved = await r.resolve();
    assert.equal(resolved.kind, 'remote-unavailable');
    if (resolved.kind === 'remote-unavailable') {
      assert.equal(resolved.error.code, 'AUTH_REQUIRED');
    }
  });
});
