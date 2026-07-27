import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FRESHNESS_POLICY,
  DEFAULT_RESEARCH_BUDGET,
  decideLiveKnowledge,
  freshnessSecondsFor,
  isSafeExternalUrl,
  isTierPermitted,
  liveKnowledgeAuditFields,
  liveKnowledgeDisclosure,
  parseLiveKnowledgeMode,
  permittedTiers,
  permitsExternalLookup,
  safeUrlForAudit,
  type LiveKnowledgeConnector,
  type LiveKnowledgeMode,
  type LiveSearchResult,
  type TrustTier,
} from '../src/engine/liveKnowledge/liveKnowledgeDecision.js';

/**
 * Live knowledge is a NETWORK EGRESS boundary, so it fails closed.
 *
 * The repository-grounding work established the pattern: enforce the policy before
 * anything can use it, and never let a mode silently become a different mode. Here the
 * stakes are higher — a grounding mistake reads the wrong local file, while a live
 * mistake makes an outbound request the operator never authorised. So `off` is the
 * default for anything unrecognised, `off` is proven to touch no connector at all, and
 * `official` is proven never to widen into general web search.
 */

const NOW = '2026-07-27T02:45:00.000Z';

function result(over: Partial<LiveSearchResult> = {}): LiveSearchResult {
  return {
    id: over.id ?? 's1',
    title: 'Docs',
    url: over.url ?? 'https://docs.example.com/guide',
    domain: over.domain ?? 'docs.example.com',
    retrievedAt: NOW,
    trustTier: over.trustTier ?? 1,
    sourceType: over.sourceType ?? 'official-docs',
    ...over,
  };
}

/** A connector that FAILS the test if it is ever touched. */
function forbiddenConnector(): LiveKnowledgeConnector & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'forbidden',
    calls,
    async search() {
      calls.push('search');
      throw new Error('connector must not be called');
    },
    async fetch() {
      calls.push('fetch');
      throw new Error('connector must not be called');
    },
  };
}

function connectorReturning(results: LiveSearchResult[]): LiveKnowledgeConnector & { searches: number } {
  const c = {
    id: 'stub',
    searches: 0,
    async search() {
      c.searches += 1;
      return results;
    },
    async fetch(): Promise<never> {
      throw new Error('not used');
    },
  };
  return c as LiveKnowledgeConnector & { searches: number };
}

const deps = (connector?: LiveKnowledgeConnector) => ({
  ...(connector ? { connector } : {}),
  now: () => NOW,
});

// ── off: zero external I/O ───────────────────────────────────────────────────

test('off performs ZERO connector calls', async () => {
  const connector = forbiddenConnector();
  const { decision, accepted } = await decideLiveKnowledge({ mode: 'off', query: 'latest CVE' }, deps(connector));

  assert.deepEqual(connector.calls, [], 'the connector must not be touched at all');
  assert.equal(decision.effectiveMode, 'off');
  assert.equal(decision.gateDecision, 'live-knowledge-disabled');
  assert.equal(decision.sourcesConsulted, 0);
  assert.equal(decision.sourcesAccepted, 0);
  assert.equal(decision.researchedAt, undefined, 'nothing was researched, so nothing is timestamped');
  assert.deepEqual(accepted, []);
});

test('a request with NO live mode stays offline', async () => {
  const connector = forbiddenConnector();
  // Every caller written before this field existed lands here.
  for (const missing of [undefined, null, '', 'WEB', 'official ', 'internet', 0, true]) {
    const { decision } = await decideLiveKnowledge({ mode: missing as never, query: 'q' }, deps(connector));
    assert.equal(decision.requestedMode, 'off', `must default to off for ${JSON.stringify(missing)}`);
    assert.equal(decision.gateDecision, 'live-knowledge-disabled');
  }
  assert.deepEqual(connector.calls, [], 'no unrecognised value may reach the network');
});

test('the parser fails CLOSED, unlike the grounding parser', () => {
  assert.equal(parseLiveKnowledgeMode('web'), 'web');
  assert.equal(parseLiveKnowledgeMode('official'), 'official');
  assert.equal(parseLiveKnowledgeMode('off'), 'off');
  // Anything else is off — a permissive default would grant egress by accident.
  for (const bad of ['Web', 'all', undefined, null, 42]) assert.equal(parseLiveKnowledgeMode(bad), 'off');
});

// ── tier enforcement ─────────────────────────────────────────────────────────

test('official permits Tier 1 ONLY', () => {
  assert.deepEqual(permittedTiers('official'), [1]);
  assert.equal(isTierPermitted('official', 1), true);
  for (const tier of [2, 3, 4] as TrustTier[]) {
    assert.equal(isTierPermitted('official', tier), false, `Tier ${tier} must be rejected in official mode`);
  }
});

test('web permits Tiers 1–3 but never Tier 4', () => {
  assert.deepEqual(permittedTiers('web'), [1, 2, 3]);
  for (const tier of [1, 2, 3] as TrustTier[]) assert.equal(isTierPermitted('web', tier), true);
  assert.equal(isTierPermitted('web', 4), false);
});

test('Tier 4 is rejected in EVERY mode', () => {
  for (const mode of ['off', 'official', 'web'] as LiveKnowledgeMode[]) {
    assert.equal(isTierPermitted(mode, 4), false, `${mode} must never accept Tier 4`);
  }
  // It appears in no permitted set, so widening a range cannot admit it.
  assert.ok(!permittedTiers('web').includes(4 as TrustTier));
});

test('off permits no tier at all, so one check covers "may I look"', () => {
  assert.deepEqual(permittedTiers('off'), []);
  assert.equal(permitsExternalLookup('off'), false);
  assert.equal(permitsExternalLookup('official'), true);
  assert.equal(permitsExternalLookup('web'), true);
});

test('official REJECTS Tier 2 and 3 results the connector returns', async () => {
  const connector = connectorReturning([
    result({ id: 'a', trustTier: 1, url: 'https://docs.python.org/3/library/os.html' }),
    result({ id: 'b', trustTier: 2, url: 'https://example-publisher.com/post', sourceType: 'news' }),
    result({ id: 'c', trustTier: 3, url: 'https://someblog.example/thoughts', sourceType: 'general-web' }),
  ]);
  const { decision, accepted } = await decideLiveKnowledge({ mode: 'official', query: 'q' }, deps(connector));

  assert.equal(decision.sourcesConsulted, 3);
  assert.equal(decision.sourcesAccepted, 1, 'only the Tier 1 source survives');
  assert.deepEqual(accepted.map((a) => a.result.id), ['a']);
  assert.equal(decision.gateDecision, 'official-sources-used');
  assert.deepEqual(decision.trustTierCounts, { 1: 1 });
});

test('official NEVER falls back to web when nothing authoritative is found', async () => {
  const connector = connectorReturning([
    result({ id: 'b', trustTier: 2 }),
    result({ id: 'c', trustTier: 3 }),
  ]);
  const { decision, accepted } = await decideLiveKnowledge({ mode: 'official', query: 'q' }, deps(connector));

  assert.equal(decision.effectiveMode, 'official', 'the mode must not widen');
  assert.notEqual(decision.gateDecision, 'web-research-used');
  assert.equal(decision.gateDecision, 'official-sources-insufficient');
  assert.equal(decision.sourcesAccepted, 0, 'better to answer without it than to widen silently');
  assert.deepEqual(accepted, []);
  assert.equal(connector.searches, 1, 'and it does not search again as web');
});

test('web accepts a mixed permitted set and reports the trust split', async () => {
  const connector = connectorReturning([
    result({ id: 'a', trustTier: 1 }),
    result({ id: 'b', trustTier: 2 }),
    result({ id: 'c', trustTier: 3 }),
    result({ id: 'd', trustTier: 4, url: 'https://contentfarm.example/x' }),
  ]);
  const { decision, accepted } = await decideLiveKnowledge({ mode: 'web', query: 'q' }, deps(connector));

  assert.equal(decision.gateDecision, 'web-research-used');
  assert.equal(decision.sourcesAccepted, 3, 'Tier 4 excluded');
  assert.deepEqual(accepted.map((a) => a.result.id), ['a', 'b', 'c']);
  assert.deepEqual(decision.trustTierCounts, { 1: 1, 2: 1, 3: 1 });
});

// ── no silent degradation ────────────────────────────────────────────────────

test('a missing connector is a FAILURE, never reported as disabled', async () => {
  const { decision } = await decideLiveKnowledge({ mode: 'official', query: 'q' }, { now: () => NOW });

  assert.equal(decision.gateDecision, 'live-research-failed');
  assert.equal(decision.failureCategory, 'no-connector');
  assert.notEqual(decision.gateDecision, 'live-knowledge-disabled', 'an outage must not look like a setting');
  assert.equal(decision.effectiveMode, 'official', 'what was asked for is still recorded');
});

test('a connector error is classified, not swallowed', async () => {
  const boom: LiveKnowledgeConnector = {
    id: 'boom',
    async search() { throw new Error('upstream 503'); },
    async fetch(): Promise<never> { throw new Error('x'); },
  };
  const { decision, accepted } = await decideLiveKnowledge({ mode: 'web', query: 'q' }, deps(boom));

  assert.equal(decision.gateDecision, 'live-research-failed');
  assert.equal(decision.failureCategory, 'connector-error');
  assert.deepEqual(accepted, [], 'a failure yields no citable sources');
});

test('cancellation is reported as cancelled, not as an error', async () => {
  const ac = new AbortController();
  const cancelling: LiveKnowledgeConnector = {
    id: 'c',
    async search() { ac.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
    async fetch(): Promise<never> { throw new Error('x'); },
  };
  const { decision } = await decideLiveKnowledge({ mode: 'web', query: 'q' }, deps(cancelling), ac.signal);

  assert.equal(decision.failureCategory, 'cancelled');
});

test('every mode records requested AND effective', async () => {
  for (const mode of ['off', 'official', 'web'] as LiveKnowledgeMode[]) {
    const { decision } = await decideLiveKnowledge({ mode, query: 'q' }, deps(connectorReturning([result()])));
    assert.equal(decision.requestedMode, mode);
    assert.ok(decision.effectiveMode !== undefined);
    // The effective mode is never MORE permissive than what was requested.
    assert.ok(permittedTiers(decision.effectiveMode).length <= permittedTiers(mode).length);
  }
});

// ── security: URL safety ─────────────────────────────────────────────────────

test('loopback, private, link-local and CGNAT addresses are blocked', () => {
  const blocked = [
    'http://localhost/x', 'http://localhost:8080/x', 'https://foo.localhost/x', 'https://svc.local/x',
    'http://127.0.0.1/x', 'http://127.1.2.3/x', 'http://0.0.0.0/x',
    'http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://172.16.0.1/x', 'http://172.31.255.255/x',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata — the classic SSRF target
    'http://100.64.0.1/x', 'http://224.0.0.1/x',
    'http://[::1]/x', 'http://[fe80::1]/x', 'http://[fc00::1]/x', 'http://[::ffff:10.0.0.1]/x',
  ];
  for (const url of blocked) assert.equal(isSafeExternalUrl(url), false, `must block ${url}`);
});

test('public https URLs are allowed', () => {
  for (const url of ['https://docs.python.org/3/', 'https://github.com/nodejs/node/releases', 'http://example.com/a?b=1']) {
    assert.equal(isSafeExternalUrl(url), true, `must allow ${url}`);
  }
});

test('non-HTTP schemes and embedded credentials are refused', () => {
  for (const url of [
    'file:///etc/passwd', 'ftp://example.com/x', 'data:text/html,<script>', 'javascript:alert(1)',
    'https://user:pass@example.com/x', 'https://user@example.com/x',
    'not a url', '',
  ]) {
    assert.equal(isSafeExternalUrl(url), false, `must refuse ${url}`);
  }
});

test('a result pointing at a private address is rejected even at Tier 1', async () => {
  const connector = connectorReturning([
    result({ id: 'ssrf', trustTier: 1, url: 'http://169.254.169.254/latest/meta-data/', domain: 'docs.example.com' }),
  ]);
  const { decision, accepted } = await decideLiveKnowledge({ mode: 'official', query: 'q' }, deps(connector));

  assert.deepEqual(accepted, [], 'a claimed Tier 1 cannot launder an internal address');
  assert.equal(decision.sourcesAccepted, 0);
  assert.equal(decision.gateDecision, 'official-sources-insufficient');
});

test('audit URLs keep origin and path only', () => {
  assert.equal(safeUrlForAudit('https://example.com/a/b?token=secret#frag'), 'https://example.com/a/b');
  assert.equal(safeUrlForAudit('https://u:p@example.com/a?k=v'), 'https://example.com/a');
  assert.equal(safeUrlForAudit('nonsense'), undefined);
});

// ── audit: metadata only ─────────────────────────────────────────────────────

test('the audit record carries no query, page content or full URL', async () => {
  const query = 'CVE for acme-corp internal token ghp_ABCDEFG123456';
  const connector = connectorReturning([
    result({ id: 'a', trustTier: 1, url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1?apiKey=SECRET', snippet: 'page body text here' }),
  ]);
  const { decision } = await decideLiveKnowledge({ mode: 'official', query }, deps(connector));
  const fields = liveKnowledgeAuditFields(decision, { startedAt: NOW, completedAt: NOW, durationMs: 12 });
  const serialized = JSON.stringify(fields);

  // Present: the metadata an operator needs.
  for (const key of ['requestedMode', 'effectiveMode', 'gateDecision', 'sourcesConsulted', 'sourcesAccepted']) {
    assert.ok(key in fields, `must record ${key}`);
  }
  assert.equal(fields.durationMs, 12);

  // Absent: everything derived from user content or page bodies.
  assert.ok(!serialized.includes('ghp_ABCDEFG'), 'the query must never be persisted');
  assert.ok(!serialized.includes('acme-corp'), 'nor any part of it');
  assert.ok(!serialized.includes('page body text'), 'nor a snippet');
  assert.ok(!serialized.includes('apiKey'), 'nor a URL query parameter');
  assert.ok(!serialized.includes('SECRET'));
  assert.ok(!serialized.includes('/vuln/detail'), 'domains only, not paths');
});

test('domainsConsulted is derived from the URL, not the claimed domain', async () => {
  // A connector claiming `docs.example.com` while linking elsewhere must not have its
  // label believed in the audit trail.
  const connector = connectorReturning([result({ url: 'https://evil.example.net/x', domain: 'docs.example.com' })]);
  const { decision } = await decideLiveKnowledge({ mode: 'web', query: 'q' }, deps(connector));

  assert.deepEqual(decision.domainsConsulted, ['evil.example.net']);
});

// ── disclosure ───────────────────────────────────────────────────────────────

test('disclosure is produced from the decision for every outcome', async () => {
  const off = await decideLiveKnowledge({ mode: 'off', query: 'q' }, deps());
  assert.equal(liveKnowledgeDisclosure(off.decision), 'Live knowledge: Off');

  const used = await decideLiveKnowledge(
    { mode: 'web', query: 'q' },
    deps(connectorReturning([result({ id: 'a', trustTier: 1 }), result({ id: 'b', trustTier: 2 })])),
  );
  const web = liveKnowledgeDisclosure(used.decision);
  assert.match(web, /Web research/);
  assert.match(web, /Sources accepted: 2/);
  assert.match(web, /1 authoritative, 1 independent/);
  assert.match(web, /Checked 2026-07-27T02:45/);

  const none = await decideLiveKnowledge({ mode: 'official', query: 'q' }, deps(connectorReturning([result({ trustTier: 3 })])));
  assert.match(liveKnowledgeDisclosure(none.decision), /no authoritative sources found \(1 considered\)/);

  const failed = await decideLiveKnowledge({ mode: 'official', query: 'q' }, { now: () => NOW });
  assert.match(liveKnowledgeDisclosure(failed.decision), /unavailable \(no-connector\)/);
});

// ── budgets and freshness are configurable, not scattered literals ───────────

test('the document budget caps accepted sources', async () => {
  const many = Array.from({ length: 20 }, (_, i) => result({ id: `s${i}`, trustTier: 1 }));
  const { decision } = await decideLiveKnowledge(
    { mode: 'web', query: 'q' },
    { ...deps(connectorReturning(many)), budget: { ...DEFAULT_RESEARCH_BUDGET, maxDocuments: 2 } },
  );
  assert.equal(decision.sourcesAccepted, 2, 'a hard cap, not a hint');
});

test('research budget defaults are bounded', () => {
  assert.ok(DEFAULT_RESEARCH_BUDGET.maxSearches <= 5);
  assert.ok(DEFAULT_RESEARCH_BUDGET.maxDocuments <= 10);
  assert.ok(DEFAULT_RESEARCH_BUDGET.absoluteTimeoutMs > 0, 'research is not streaming, so a ceiling is right here');
  assert.ok(DEFAULT_RESEARCH_BUDGET.maxRedirects <= 5);
});

test('freshness is per source class and configurable', () => {
  assert.equal(freshnessSecondsFor('status-page' as never, DEFAULT_FRESHNESS_POLICY) ?? undefined, undefined);
  assert.equal(freshnessSecondsFor('security-advisory'), 3600);
  assert.equal(freshnessSecondsFor('news'), 1800);
  assert.equal(freshnessSecondsFor('official-docs'), 86_400);
  // Overridable without touching call sites.
  assert.equal(freshnessSecondsFor('security-advisory', { ...DEFAULT_FRESHNESS_POLICY, securityAdvisorySeconds: 60 }), 60);
});

// ── the two dimensions are INDEPENDENT (route level) ─────────────────────────

test('repository mode and live mode never imply one another', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { registerEngineerRoutes } = await import('../src/engine/engineerRoutes.js');
  const { registerToolExecutionRoutes } = await import('../src/engine/toolRoutes.js');
  const { ModelRegistry } = await import('../src/engine/modelRegistry.js');
  const { auditStore } = await import('../src/engine/auditLog.js');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const CAPS = { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false };
  const stub = {
    async complete() { return { content: 'ANSWER: ok', modelId: 'm', providerId: 'local' }; },
    async *stream() { yield { delta: 'ANSWER: ok' } as never; },
    async isAvailable() { return true; },
  } as never;

  const app = Fastify({ logger: false });
  t.after(() => app.close());
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(
    app,
    { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never,
    new ModelRegistry({ sources: [], staticModels: [{ id: 'qwen2.5-coder:14b', provider: 'local', capabilities: CAPS, tier: 'balanced' }] }),
    toolDeps,
    () => stub,
  );

  // The full matrix the slice specifies. Neither dimension may move the other.
  const matrix = [
    { groundingMode: 'approved', liveKnowledgeMode: 'official' },
    { groundingMode: 'workspace', liveKnowledgeMode: 'web' },
    { groundingMode: 'none', liveKnowledgeMode: 'official' },
    { groundingMode: 'approved', liveKnowledgeMode: 'off' },
    { groundingMode: 'none', liveKnowledgeMode: 'off' },
  ] as const;

  for (const [i, combo] of matrix.entries()) {
    const correlationId = `indep-${process.pid}-${i}`;
    await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: { 'x-correlation-id': correlationId },
      payload: { rootPath: mkdtempSync(tmpdir() + '/indep-'), task: 'explain something', ...combo },
    });

    const rows = auditStore.byCorrelation(correlationId);
    const live = rows.find((r) => r.type === 'liveKnowledge.decided');
    const repo = rows.find((r) => r.type === 'retrieval.decided');

    assert.ok(live, `${JSON.stringify(combo)}: a live decision is always recorded`);
    assert.equal(live!.fields.requestedMode, combo.liveKnowledgeMode, 'the live mode is recorded verbatim');

    // Repository grounding is unaffected by the live mode.
    if (repo) {
      assert.equal(repo.fields.requestedMode, combo.groundingMode, 'the repository mode is unchanged by the live mode');
    }
    // And `none` repository evidence does NOT disable live research.
    if (combo.groundingMode === 'none' && combo.liveKnowledgeMode === 'official') {
      assert.notEqual(live!.fields.gateDecision, 'live-knowledge-disabled', 'none-repository must not switch live off');
    }
    // `off` live knowledge does NOT change repository grounding.
    if (combo.liveKnowledgeMode === 'off') {
      assert.equal(live!.fields.gateDecision, 'live-knowledge-disabled');
    }
  }
});

test('a request with no live field is recorded as off on the real route', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { registerEngineerRoutes } = await import('../src/engine/engineerRoutes.js');
  const { registerToolExecutionRoutes } = await import('../src/engine/toolRoutes.js');
  const { ModelRegistry } = await import('../src/engine/modelRegistry.js');
  const { auditStore } = await import('../src/engine/auditLog.js');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const CAPS = { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false };
  const stub = {
    async complete() { return { content: 'ANSWER: ok', modelId: 'm', providerId: 'local' }; },
    async *stream() { yield { delta: 'ANSWER: ok' } as never; },
    async isAvailable() { return true; },
  } as never;

  const app = Fastify({ logger: false });
  t.after(() => app.close());
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(
    app,
    { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never,
    new ModelRegistry({ sources: [], staticModels: [{ id: 'qwen2.5-coder:14b', provider: 'local', capabilities: CAPS, tier: 'balanced' }] }),
    toolDeps,
    () => stub,
  );

  const correlationId = `legacy-${process.pid}`;
  await app.inject({
    method: 'POST',
    url: '/api/ai/engineer',
    headers: { 'x-correlation-id': correlationId },
    // No liveKnowledgeMode at all — every caller written before this field.
    payload: { rootPath: mkdtempSync(tmpdir() + '/legacy-'), task: 'explain something' },
  });

  const live = auditStore.byCorrelation(correlationId).find((r) => r.type === 'liveKnowledge.decided');
  assert.ok(live, 'the decision is recorded even when the field is absent');
  assert.equal(live!.fields.requestedMode, 'off', 'absence means off');
  assert.equal(live!.fields.gateDecision, 'live-knowledge-disabled');
  assert.equal(live!.fields.sourcesConsulted, 0);
});
