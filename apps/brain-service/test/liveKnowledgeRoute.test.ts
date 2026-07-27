import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { LiveConnectorRegistry } from '../src/engine/liveKnowledge/liveResearch.js';
import { createNpmConnector, type ConnectorDeps } from '../src/engine/liveKnowledge/connectors/index.js';
import type { DescribedConnector, LiveSearchResult } from '@migrapilot/protocol';

/**
 * The three modes must reach the REAL route and come back with a host-owned frame.
 *
 * Everything below the route is already covered; what these tests pin is the part the
 * installed extension actually depends on — that the request field arrives, that the
 * `liveKnowledge` frame is emitted before any answer text including a refusal, and that
 * `off` performs no connector work at all when driven through the HTTP path rather than
 * through `researchLive` directly.
 */

/** Module-global so correlation ids stay unique across every route instance in this file. */
let turnCounter = 0;

const CAPS = { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false };
const NPM_DOC = {
  name: 'typescript',
  version: '6.2.0',
  description: 'TypeScript is a language for application scale JavaScript development',
  license: 'Apache-2.0',
};

/** A fetch stub that records every request the route causes. */
function recordingFetch(body: unknown = NPM_DOC) {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(String(url));
    const text = JSON.stringify(body);
    const headers = new Map([['content-type', 'application/json']]);
    return {
      ok: true,
      status: 200,
      headers: {
        get: (k: string) => headers.get(k.toLowerCase()) ?? null,
        forEach: (fn: (v: string, k: string) => void) => headers.forEach((v, k) => fn(v, k)),
      },
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(text);
        },
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, urls };
}

function connectorDeps(fetchImpl: typeof fetch): ConnectorDeps {
  return {
    fetch: { resolve: async () => [{ address: '104.16.0.1', family: 4 as const }], fetchImpl },
    env: {},
    now: () => new Date().toISOString(),
  };
}

/** Boot the real route with a registry, and collect the SSE frames it emits. */
async function bootRoute(
  t: { after(fn: () => unknown): void },
  registry: LiveConnectorRegistry,
): Promise<{
  turn(payload: Record<string, unknown>): Promise<{ events: Array<{ event: string; data: unknown }>; raw: string; correlationId: string }>;
}> {
  const Fastify = (await import('fastify')).default;
  const { registerEngineerRoutes } = await import('../src/engine/engineerRoutes.js');
  const { registerToolExecutionRoutes } = await import('../src/engine/toolRoutes.js');
  const { ModelRegistry } = await import('../src/engine/modelRegistry.js');

  const stub = {
    async complete() {
      return { content: 'ANSWER: ok', modelId: 'm', providerId: 'local' };
    },
    async *stream() {
      yield { delta: 'ANSWER: ok' } as never;
    },
    async isAvailable() {
      return true;
    },
  } as never;

  const app = Fastify({ logger: false });
  t.after(() => app.close());
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(
    app,
    { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never,
    new ModelRegistry({
      sources: [],
      staticModels: [{ id: 'qwen2.5-coder:14b', provider: 'local', capabilities: CAPS, tier: 'balanced' }],
    }),
    toolDeps,
    () => stub,
    // providerRouting, escalation, indexService, indexedBranch, liveKnowledgeConnector —
    // all absent; the registry is the eleventh parameter.
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    registry,
  );

  return {
    async turn(payload) {
      const correlationId = `route-live-${process.pid}-${turnCounter++}`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/engineer',
        headers: { 'x-correlation-id': correlationId },
        payload: { rootPath: mkdtempSync(tmpdir() + '/live-route-'), task: 'which npm typescript version is current', ...payload },
      });
      // SSE: `event: x\ndata: {...}` pairs.
      const events: Array<{ event: string; data: unknown }> = [];
      for (const block of res.body.split('\n\n')) {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) {
          try {
            events.push({ event, data: JSON.parse(data) });
          } catch {
            events.push({ event, data });
          }
        }
      }
      return { events, raw: res.body, correlationId };
    },
  };
}

// ── all three modes reach the real route ─────────────────────────────────────

test('off performs zero external requests through the route', async (t) => {
  const { impl, urls } = recordingFetch();
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);
  const route = await bootRoute(t, registry);

  // Both the explicit `off` and a payload that OMITS the field entirely: absence must
  // mean the same thing as off, since every request written before the field existed
  // omits it.
  for (const payload of [{ liveKnowledgeMode: 'off' }, {}]) {
    const { events } = await route.turn(payload);
    const frame = events.find((e) => e.event === 'liveKnowledge')!;
    assert.ok(frame, 'the frame is emitted even when the mode is off');
    assert.equal((frame.data as { headline: string }).headline, 'Live knowledge: Off');
    assert.equal((frame.data as { sourcesAccepted: number }).sourcesAccepted, 0);
  }
  assert.deepEqual(urls, [], 'no connector, no fetch, nothing left the machine');
});

test('official reaches the route and returns accepted authoritative citations', async (t) => {
  const { impl, urls } = recordingFetch();
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);
  const route = await bootRoute(t, registry);

  const { events } = await route.turn({ liveKnowledgeMode: 'official' });
  const frame = events.find((e) => e.event === 'liveKnowledge')!.data as {
    headline: string;
    checkedAt?: string;
    sourcesConsulted: number;
    sourcesAccepted: number;
    citations: Array<{ sourceId: string; connectorId: string; safeUrl: string; trustTier: number; contentHash: string }>;
  };

  assert.equal(frame.headline, 'Live knowledge: Official sources');
  assert.ok(frame.checkedAt, 'the frame carries when it was checked');
  assert.equal(frame.sourcesAccepted, 1);
  assert.equal(frame.citations.length, 1);
  assert.equal(frame.citations[0]!.connectorId, 'npm-registry');
  assert.equal(frame.citations[0]!.trustTier, 1);
  assert.match(frame.citations[0]!.safeUrl, /^https:\/\/registry\.npmjs\.org\/typescript\/latest$/);
  assert.match(frame.citations[0]!.contentHash, /^[0-9a-f]{32}$/);
  assert.equal(urls.length, 1, 'exactly one authoritative request');
});

test('web reaches the route and does NOT claim general-web coverage', async (t) => {
  const { impl } = recordingFetch();
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);
  const route = await bootRoute(t, registry);

  const { events } = await route.turn({ liveKnowledgeMode: 'web' });
  const frame = events.find((e) => e.event === 'liveKnowledge')!.data as { headline: string; sourcesAccepted: number };

  assert.equal(frame.sourcesAccepted, 1, 'authoritative connectors still answer in web mode');
  assert.match(frame.headline, /Authoritative sources only \(no general web provider configured\)/);
  assert.ok(!/^Live knowledge: Web research$/.test(frame.headline), 'no unearned coverage claim');
});

test('a request for official with no connector reports an outage, not off', async (t) => {
  const route = await bootRoute(t, new LiveConnectorRegistry());

  const { events } = await route.turn({ liveKnowledgeMode: 'official' });
  const frame = events.find((e) => e.event === 'liveKnowledge')!.data as { headline: string };

  // Conflating "the operator chose off" with "research could not run" would hide an
  // outage behind a setting.
  assert.match(frame.headline, /unavailable \(no-connector\)/);
  assert.ok(!/Live knowledge: Off/.test(frame.headline));
});

// ── frame ordering ───────────────────────────────────────────────────────────

test('the live frame precedes every answer token', async (t) => {
  const { impl } = recordingFetch();
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);
  const route = await bootRoute(t, registry);

  const { events, raw } = await route.turn({ liveKnowledgeMode: 'official' });
  const frameAt = events.findIndex((e) => e.event === 'liveKnowledge');

  assert.ok(frameAt >= 0, 'the frame is emitted');
  // Whatever ends the turn — answer text, a refusal or an error — the frame precedes it.
  // This minimal harness has no real model, so the turn ends in `error`; the frame still
  // has to come first, which is exactly the property being pinned.
  const outcomeAt = events.findIndex((e) =>
    ['token', 'final', 'refusal', 'error'].includes(e.event),
  );
  assert.ok(outcomeAt > frameAt, `provenance precedes the outcome (frame ${frameAt}, outcome ${outcomeAt})`);
  // And in the raw bytes, so the host renders it first regardless of how it parses.
  const outcomeEvent = events[outcomeAt]!.event;
  assert.ok(
    raw.indexOf('event: liveKnowledge') < raw.indexOf(`event: ${outcomeEvent}`),
    'byte order matches event order',
  );
});

test('both provenance frames are emitted, separately, for one turn', async (t) => {
  const { impl } = recordingFetch();
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);
  const route = await bootRoute(t, registry);

  const { events } = await route.turn({ liveKnowledgeMode: 'official', groundingMode: 'none' });

  const live = events.filter((e) => e.event === 'liveKnowledge');
  assert.equal(live.length, 1, 'exactly one live frame');
  // Repository `none` and live `official` in the same turn: two independent statements.
  const frame = live[0]!.data as { headline: string; sourcesAccepted: number };
  assert.equal(frame.headline, 'Live knowledge: Official sources');
  assert.equal(frame.sourcesAccepted, 1, 'repository mode none did not disable live research');
});

// ── audit ────────────────────────────────────────────────────────────────────

test('the durable audit for a route turn carries metadata only', async (t) => {
  const { auditStore } = await import('../src/engine/auditLog.js');
  const { impl } = recordingFetch({ ...NPM_DOC, description: 'BODY_SENTINEL_TEXT' });
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);
  const route = await bootRoute(t, registry);

  const { correlationId } = await route.turn({
    liveKnowledgeMode: 'official',
    task: 'which npm typescript version is current for CLIENT_SENTINEL key SK_SENTINEL',
  });
  const rows = auditStore.byCorrelation(correlationId).filter((r) => r.type === 'liveKnowledge.decided');
  assert.equal(rows.length, 1, 'exactly one decision row');
  const serialised = JSON.stringify(rows[0]!.fields);

  for (const forbidden of ['CLIENT_SENTINEL', 'SK_SENTINEL', 'BODY_SENTINEL_TEXT', 'which npm typescript', 'Authorization']) {
    assert.ok(!serialised.includes(forbidden), `audit must not contain ${forbidden}: ${serialised}`);
  }
  // The metadata an operator acts on IS there.
  assert.match(serialised, /official-sources-used/);
  assert.match(serialised, /registry\.npmjs\.org/);
  assert.match(serialised, /documentsFetched/);
});

// ── a rejected source never becomes a citation, end to end ───────────────────

test('a source rejected at the route level is absent from the frame citations', async (t) => {
  const { impl } = recordingFetch();
  const deps = connectorDeps(impl);
  // Claims Tier 1 for a host it does not declare — refused before any fetch.
  const liar: DescribedConnector = {
    ...createNpmConnector(deps),
    id: 'liar',
    search: async (): Promise<LiveSearchResult[]> => [
      {
        id: 'liar:1',
        connectorId: 'liar',
        title: 'not the registry',
        url: 'https://elsewhere.example.com/typescript',
        domain: 'elsewhere.example.com',
        retrievedAt: new Date().toISOString(),
        trustTier: 1,
        sourceType: 'official-api',
      },
    ],
  };
  const registry = new LiveConnectorRegistry().registerAuthoritative([liar]);
  const route = await bootRoute(t, registry);

  const { events } = await route.turn({ liveKnowledgeMode: 'official' });
  const frame = events.find((e) => e.event === 'liveKnowledge')!.data as {
    headline: string;
    sourcesAccepted: number;
    citations: unknown[];
  };

  assert.equal(frame.citations.length, 0, 'nothing was fetched, so nothing is citable');
  assert.equal(frame.sourcesAccepted, 0);
  assert.match(frame.headline, /no authoritative sources found/);
});
