import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LiveConnectorRegistry,
  buildCitations,
  buildLiveKnowledgeFrame,
  liveResearchAuditFields,
  renderLiveKnowledgeFrame,
  researchLive,
} from '../src/engine/liveKnowledge/liveResearch.js';
import {
  ADVISORY_CONNECTOR_ID,
  DEFAULT_STATUS_ENDPOINTS,
  DEFAULT_VENDOR_DOC_SITES,
  GITHUB_CONNECTOR_ID,
  NPM_CONNECTOR_ID,
  OCI_CONNECTOR_ID,
  PYPI_CONNECTOR_ID,
  STATUS_CONNECTOR_ID,
  VENDOR_DOCS_CONNECTOR_ID,
  buildAuthoritativeConnectors,
  createGitHubConnector,
  createNpmConnector,
  createStatusConnector,
  createVendorDocsConnector,
  extractPackageName,
  NAME_PATTERNS,
  type ConnectorDeps,
} from '../src/engine/liveKnowledge/connectors/index.js';
import { isAllowedContentType } from '../src/engine/liveKnowledge/liveFetch.js';
import { DEFAULT_RESEARCH_BUDGET } from '../src/engine/liveKnowledge/liveKnowledgeDecision.js';
import type { DescribedConnector, LiveSearchResult } from '@migrapilot/protocol';

/**
 * The authoritative connector set, end to end.
 *
 * These connectors are entity lookups against first-party APIs, which is what earns
 * their Tier 1 claim — the npm registry is definitive about npm packages in a way no
 * blog post about them can be. So the tests care about two things above all: that
 * `official` accepts nothing else, and that provenance describes exactly what was
 * fetched.
 *
 * Payloads are injected rather than fetched, so every branch is deterministic. A
 * separate script proves the same paths against the real endpoints.
 */

const NOW = '2026-07-27T03:10:00.000Z';
const publicAddr = [{ address: '140.82.121.6', family: 4 as const }];

/** A fetch stub keyed by URL substring, recording every request and its headers. */
function apiStub(routes: Array<{ match: string; status?: number; body?: unknown; contentType?: string; fail?: boolean }>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
    const route = routes.find((r) => String(url).includes(r.match));
    if (!route) throw new Error(`no stub route for ${url}`);
    if (route.fail) throw new Error('upstream exploded');
    const text = typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {});
    const headers = new Map([['content-type', route.contentType ?? 'application/json']]);
    return {
      ok: (route.status ?? 200) < 300,
      status: route.status ?? 200,
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
  return { impl, calls };
}

function connectorDeps(fetchImpl: typeof fetch, env: Record<string, string | undefined> = {}): ConnectorDeps {
  return {
    fetch: { resolve: async () => publicAddr, fetchImpl, now: () => new Date(NOW) },
    env,
    now: () => NOW,
  };
}

function researchDeps(registry: LiveConnectorRegistry, fetchImpl: typeof fetch, budget = DEFAULT_RESEARCH_BUDGET) {
  return {
    registry,
    fetch: { resolve: async () => publicAddr, fetchImpl, now: () => new Date(NOW) },
    now: () => NOW,
    budget,
  };
}

const RELEASE = {
  tag_name: 'v24.1.0',
  name: 'Node.js v24.1.0',
  published_at: '2026-07-20T10:00:00.000Z',
  html_url: 'https://github.com/nodejs/node/releases/tag/v24.1.0',
  prerelease: false,
  body: 'Notable changes: the HTTP parser was updated.',
};

/**
 * The `/latest` manifest, matching the real endpoint's shape.
 *
 * Not the full packument: typescript's is 8.6 MB, seventeen times the per-document cap,
 * so the whole-package endpoint could only ever be refused for size. The live run caught
 * that; a fixture shaped like the endpoint we do not call would have hidden it.
 */
const NPM_DOC = {
  name: 'typescript',
  version: '6.2.0',
  description: 'TypeScript is a language for application scale JavaScript development',
  license: 'Apache-2.0',
  engines: { node: '>=20' },
  dist: { integrity: 'sha512-FIXTUREINTEGRITY' },
};

// ── authoritative lookups succeed ────────────────────────────────────────────

test('official GitHub release lookup succeeds and carries provenance', async () => {
  const { impl, calls } = apiStub([{ match: '/releases/latest', body: RELEASE }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createGitHubConnector(connectorDeps(impl))]);

  const out = await researchLive(
    { mode: 'official', query: 'what is the latest release of nodejs/node' },
    researchDeps(registry, impl),
  );

  assert.equal(out.decision.gateDecision, 'official-sources-used');
  assert.ok(out.documents.length >= 1);
  const doc = out.documents.find((d) => d.source.id.endsWith(':release'))!;
  assert.equal(doc.source.connectorId, GITHUB_CONNECTOR_ID);
  assert.equal(doc.source.trustTier, 1);
  assert.equal(doc.source.sourceType, 'release');
  assert.equal(doc.source.publishedAt, RELEASE.published_at);
  assert.match(doc.content, /tag: v24\.1\.0/);
  assert.match(doc.content, /HTTP parser was updated/);
  // Hashing and freshness are the research layer's job, not the connector's.
  assert.match(doc.contentHash, /^[0-9a-f]{32}$/);
  assert.equal(doc.expiresAt, new Date(new Date(NOW).getTime() + 3600_000).toISOString());
  assert.ok(calls.every((c) => c.url.startsWith('https://api.github.com/')), 'api.github.com only');
});

test('official package metadata lookup succeeds', async () => {
  const { impl } = apiStub([{ match: 'registry.npmjs.org', body: NPM_DOC }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);

  const out = await researchLive({ mode: 'official', query: 'which npm typescript version is current' }, researchDeps(registry, impl));

  assert.equal(out.documents.length, 1);
  const [doc] = out.documents;
  assert.equal(doc!.source.connectorId, NPM_CONNECTOR_ID);
  assert.match(doc!.content, /latest: 6\.2\.0/);
  assert.match(doc!.content, /license: Apache-2\.0/);
  assert.match(doc!.content, /integrity: sha512-FIXTUREINTEGRITY/);
  assert.match(doc!.source.url, /\/typescript\/latest$/, 'the bounded endpoint, not the packument');
});

test('a query with no recognisable entity consults nothing', async () => {
  const { impl, calls } = apiStub([{ match: 'anything', body: {} }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative(
    buildAuthoritativeConnectors(connectorDeps(impl)) as DescribedConnector[],
  );

  const out = await researchLive({ mode: 'official', query: 'how should I structure my service layer' }, researchDeps(registry, impl));

  // An authoritative connector answers about entities. Guessing would consult a registry
  // for words that were never package names.
  assert.deepEqual(calls, []);
  assert.equal(out.decision.gateDecision, 'official-sources-insufficient');
  assert.equal(out.documents.length, 0);
});

test('the URL is built from a validated identifier, never from raw query text', async () => {
  const { impl, calls } = apiStub([{ match: 'registry.npmjs.org', body: NPM_DOC }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);

  // Path traversal and a query-string injection attempt inside the "package name".
  await researchLive(
    { mode: 'official', query: 'npm package ../../etc/passwd?x=1' },
    researchDeps(registry, impl),
  );

  for (const call of calls) {
    assert.ok(!call.url.includes('..'), `traversal reached the URL: ${call.url}`);
    assert.ok(call.url.startsWith('https://registry.npmjs.org/'), call.url);
  }
});

// ── defects the live run found, which every stub had passed ──────────────────

test('the entity is found past filler words, not taken adjacent to the keyword', () => {
  const cases: Array<[string, string | undefined]> = [
    // The live failure: `say` sat next to the keyword, so a real-but-WRONG package was
    // fetched and served as authoritative Tier 1 evidence.
    ['what does pypi say about the requests package', 'requests'],
    ['pypi requests', 'requests'],
    ['tell me what pypi knows about the flask package', 'flask'],
    ['which pypi version of numpy is current', 'numpy'],
    // No identifier at all must stay undefined rather than grabbing a filler word.
    ['what does pypi say about all of this', undefined],
    ['pypi', undefined],
  ];
  for (const [query, expected] of cases) {
    assert.equal(extractPackageName(query, ['pypi', 'pip', 'python'], NAME_PATTERNS.pypi), expected, query);
  }
});

test('a vendor JSON media type is accepted by the structured suffix rule', () => {
  // npm answers with `application/vnd.npm.install-v1+json`. Refusing it made the npm
  // connector silently produce nothing in production while every stub passed.
  assert.equal(isAllowedContentType('application/vnd.npm.install-v1+json'), true);
  assert.equal(isAllowedContentType('application/vnd.github.v3+json'), true);
  assert.equal(isAllowedContentType('application/json'), true);
  // The suffix rule must not become a way in for executables.
  assert.equal(isAllowedContentType('application/vnd.microsoft.portable-executable'), false);
  assert.equal(isAllowedContentType('application/javascript'), false);
  assert.equal(isAllowedContentType('application/x-json-but-not-really'), false);
});

test('a vendor-docs redirect out of the allowlisted subtree is refused', async () => {
  const { impl } = apiStub([
    { match: 'docs.python.org/3/', status: 301, body: '', contentType: 'text/html' },
  ]);
  // A 301 that lands outside the approved prefix: the SSRF hop checks kept it off the
  // private network, but not inside the subtree the operator actually approved.
  const redirecting = (async (url: string, init?: { headers?: Record<string, string> }) => {
    const res = await (impl as (u: string, i?: unknown) => Promise<Response>)(url, init);
    if (String(url).includes('docs.python.org/3/')) {
      return {
        ok: false,
        status: 301,
        headers: {
          get: (k: string) => (k.toLowerCase() === 'location' ? 'https://docs.python.org/downloads/' : null),
          forEach: () => {},
        },
        body: undefined,
      } as unknown as Response;
    }
    return res;
  }) as unknown as typeof fetch;

  const stubbed = apiStub([{ match: 'docs.python.org/downloads/', body: '<html><body>downloads</body></html>', contentType: 'text/html' }]);
  const chained = (async (url: string, init?: { headers?: Record<string, string> }) => {
    if (String(url).includes('/3/')) return (redirecting as (u: string, i?: unknown) => Promise<Response>)(url, init);
    return (stubbed.impl as (u: string, i?: unknown) => Promise<Response>)(url, init);
  }) as unknown as typeof fetch;

  const registry = new LiveConnectorRegistry().registerAuthoritative([
    createVendorDocsConnector(connectorDeps(chained), DEFAULT_VENDOR_DOC_SITES),
  ]);
  const out = await researchLive({ mode: 'official', query: 'python documentation' }, researchDeps(registry, chained));

  assert.equal(out.documents.length, 0, 'a document from outside the subtree is not evidence');
  assert.equal(out.decision.gateDecision, 'official-sources-insufficient');
});

// ── credentials ──────────────────────────────────────────────────────────────

test('an optional credential is used when present and its absence changes nothing', async () => {
  const withToken = apiStub([{ match: '/releases/latest', body: RELEASE }]);
  const r1 = new LiveConnectorRegistry().registerAuthoritative([
    createGitHubConnector(connectorDeps(withToken.impl, { GITHUB_TOKEN: 'ghp_SECRET_VALUE' })),
  ]);
  const out1 = await researchLive({ mode: 'official', query: 'latest release of nodejs/node' }, researchDeps(r1, withToken.impl));
  assert.ok(out1.documents.length >= 1);
  const authed = withToken.calls.find((c) => c.headers['Authorization']);
  assert.equal(authed?.headers['Authorization'], 'Bearer ghp_SECRET_VALUE', 'the token is sent');

  const without = apiStub([{ match: '/releases/latest', body: RELEASE }]);
  const r2 = new LiveConnectorRegistry().registerAuthoritative([createGitHubConnector(connectorDeps(without.impl))]);
  const out2 = await researchLive({ mode: 'official', query: 'latest release of nodejs/node' }, researchDeps(r2, without.impl));

  // A missing OPTIONAL credential only costs rate limit, so the connector still runs.
  assert.ok(out2.documents.length >= 1, 'the connector works unauthenticated');
  assert.ok(without.calls.every((c) => !c.headers['Authorization']), 'and sends no header');
  assert.equal(r2.availability('official')[0]!.available, true);
});

test('an unavailable connector is reported by name without leaking a credential', async () => {
  const { impl } = apiStub([{ match: 'x', body: {} }]);
  // A connector with a REQUIRED credential that is not set.
  const gated: DescribedConnector = {
    ...createNpmConnector(connectorDeps(impl)),
    credentials: [{ envVar: 'PRIVATE_REGISTRY_TOKEN', required: true, purpose: 'reads the private registry' }],
    availability: () => ({
      connectorId: 'private-registry',
      available: false,
      coverage: 'authoritative',
      reason: 'missing-credential',
      detail: 'set PRIVATE_REGISTRY_TOKEN',
    }),
    id: 'private-registry',
  };
  const registry = new LiveConnectorRegistry().registerAuthoritative([gated, createNpmConnector(connectorDeps(impl))]);

  const availability = registry.availability('official');
  const unavailable = availability.find((a) => !a.available)!;
  assert.equal(unavailable.connectorId, 'private-registry');
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reason, 'missing-credential');
  // The NAME of the variable is what an operator needs; the value must never appear.
  assert.match(unavailable.detail, /PRIVATE_REGISTRY_TOKEN/);
  assert.ok(!JSON.stringify(availability).includes('ghp_'), 'no token material anywhere');

  // And it is excluded from the eligible set rather than allowed to fail at fetch time.
  assert.deepEqual(registry.eligible('official').map((c) => c.id), [NPM_CONNECTOR_ID]);
});

test('an empty allowlist makes a connector not-configured rather than silently idle', () => {
  const { impl } = apiStub([{ match: 'x', body: {} }]);
  const docs = createVendorDocsConnector(connectorDeps(impl), []);
  const status = createStatusConnector(connectorDeps(impl), []);

  for (const c of [docs, status]) {
    const a = c.availability();
    assert.equal(a.available, false);
    assert.equal(a.available === false && a.reason, 'not-configured');
  }
  // Configured, they become available.
  assert.equal(createVendorDocsConnector(connectorDeps(impl), DEFAULT_VENDOR_DOC_SITES).availability().available, true);
  assert.equal(createStatusConnector(connectorDeps(impl), DEFAULT_STATUS_ENDPOINTS).availability().available, true);
});

test('a missing credential disables one connector, never the whole mode', async () => {
  const { impl } = apiStub([{ match: 'registry.npmjs.org', body: NPM_DOC }]);
  const dead: DescribedConnector = {
    ...createGitHubConnector(connectorDeps(impl)),
    availability: () => ({
      connectorId: GITHUB_CONNECTOR_ID,
      available: false,
      coverage: 'authoritative',
      reason: 'missing-credential',
      detail: 'set GITHUB_ENTERPRISE_TOKEN',
    }),
  };
  const registry = new LiveConnectorRegistry().registerAuthoritative([dead, createNpmConnector(connectorDeps(impl))]);

  const out = await researchLive({ mode: 'official', query: 'npm typescript latest' }, researchDeps(registry, impl));

  assert.equal(out.documents.length, 1, 'the surviving connector still answers');
  assert.equal(out.decision.gateDecision, 'official-sources-used');
  const named = out.decision.connectorAvailability!.find((a) => !a.available)!;
  assert.equal(named.connectorId, GITHUB_CONNECTOR_ID);
});

// ── failure isolation ────────────────────────────────────────────────────────

test('one failing connector does not erase another connector results', async () => {
  const { impl } = apiStub([
    { match: 'api.github.com', fail: true },
    { match: 'registry.npmjs.org', body: NPM_DOC },
  ]);
  const deps = connectorDeps(impl);
  // A connector whose SEARCH throws, alongside one that works.
  const broken: DescribedConnector = {
    ...createGitHubConnector(deps),
    search: async () => {
      throw new Error('github search is down');
    },
  };
  const registry = new LiveConnectorRegistry().registerAuthoritative([broken, createNpmConnector(deps)]);

  const out = await researchLive({ mode: 'official', query: 'npm typescript in nodejs/node' }, researchDeps(registry, impl));

  assert.equal(out.documents.length, 1);
  assert.equal(out.documents[0]!.source.connectorId, NPM_CONNECTOR_ID);
  assert.equal(out.decision.gateDecision, 'official-sources-used');
  assert.equal(out.rejections[`connector:${GITHUB_CONNECTOR_ID}:connector-error`], 1, 'the failure is attributed, not hidden');
});

test('every connector failing is an outage, not an empty result', async () => {
  const { impl } = apiStub([{ match: 'x', body: {} }]);
  const deps = connectorDeps(impl);
  const broken = (id: string): DescribedConnector => ({
    ...createNpmConnector(deps),
    id,
    search: async () => {
      throw new Error('down');
    },
  });
  const registry = new LiveConnectorRegistry().registerAuthoritative([broken('a'), broken('b')]);

  const out = await researchLive({ mode: 'official', query: 'npm typescript' }, researchDeps(registry, impl));

  // Reporting this as "found nothing" would hide a total outage behind a normal answer.
  assert.equal(out.decision.gateDecision, 'live-research-failed');
  assert.equal(out.decision.failureCategory, 'connector-error');
  assert.equal(out.documents.length, 0);
});

// ── official never widens ────────────────────────────────────────────────────

test('official mode rejects a non-authoritative result even from a registered connector', async () => {
  const { impl, calls } = apiStub([{ match: 'blog.example.com', body: { x: 1 } }]);
  const deps = connectorDeps(impl);
  // A connector that returns a Tier 3 blog alongside nothing else.
  const sloppy: DescribedConnector = {
    ...createNpmConnector(deps),
    id: 'sloppy',
    search: async (): Promise<LiveSearchResult[]> => [
      {
        id: 'blog:1',
        connectorId: 'sloppy',
        title: 'Ten tips about typescript',
        url: 'https://blog.example.com/tips',
        domain: 'blog.example.com',
        retrievedAt: NOW,
        trustTier: 3,
        sourceType: 'general-web',
      },
    ],
  };
  const registry = new LiveConnectorRegistry().registerAuthoritative([sloppy]);

  const out = await researchLive({ mode: 'official', query: 'npm typescript tips' }, researchDeps(registry, impl));

  assert.equal(out.documents.length, 0, 'Tier 3 is not authoritative');
  assert.equal(out.decision.gateDecision, 'official-sources-insufficient');
  assert.deepEqual(calls, [], 'a rejected source is never fetched');
});

test('a connector cannot be routed to a host it does not declare', async () => {
  const { impl } = apiStub([{ match: 'evil.example.com', body: { x: 1 } }]);
  const deps = connectorDeps(impl);
  const liar: DescribedConnector = {
    ...createNpmConnector(deps),
    id: 'liar',
    // Claims Tier 1 and official-api for a host outside its declared domains.
    search: async (): Promise<LiveSearchResult[]> => [
      {
        id: 'liar:1',
        connectorId: 'liar',
        title: 'definitely the npm registry',
        url: 'https://evil.example.com/typescript',
        domain: 'evil.example.com',
        retrievedAt: NOW,
        trustTier: 1,
        sourceType: 'official-api',
      },
    ],
  };
  const registry = new LiveConnectorRegistry().registerAuthoritative([liar]);

  const out = await researchLive({ mode: 'official', query: 'npm typescript' }, researchDeps(registry, impl));

  assert.equal(out.documents.length, 0);
  assert.equal(out.rejections['unsafe-url'], 1, 'refused for leaving the declared surface');
});

// ── web mode must not overstate coverage ─────────────────────────────────────

test('web mode does not claim broad web coverage without a general web provider', async () => {
  const { impl } = apiStub([{ match: 'registry.npmjs.org', body: NPM_DOC }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);

  const out = await researchLive({ mode: 'web', query: 'npm typescript latest' }, researchDeps(registry, impl));
  const frame = buildLiveKnowledgeFrame(out);

  assert.equal(out.documents.length, 1, 'authoritative connectors still answer in web mode');
  assert.equal(out.decision.broadWebCoverage, false);
  assert.match(frame.headline, /Authoritative sources only \(no general web provider configured\)/);
  assert.ok(!/Web research/.test(frame.headline), 'must not imply a web search happened');
});

test('web mode with nothing to find reports insufficient web research', async () => {
  const { impl } = apiStub([{ match: 'x', body: {} }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);

  const out = await researchLive({ mode: 'web', query: 'general musings about architecture' }, researchDeps(registry, impl));

  assert.equal(out.decision.gateDecision, 'web-research-insufficient');
  assert.match(buildLiveKnowledgeFrame(out).headline, /no usable sources found/);
});

test('a general-web connector flips coverage and the headline', async () => {
  const { impl } = apiStub([{ match: 'search.example.com', body: 'plain result', contentType: 'text/plain' }]);
  const deps = connectorDeps(impl);
  const web: DescribedConnector = {
    id: 'general-web-search',
    coverage: 'general-web',
    // A general web provider cannot enumerate the web, so it declares no allowlist and
    // its documents go through the GENERIC guarded fetch — which still applies every
    // SSRF, size and timeout bound.
    domains: [],
    availability: () => ({ connectorId: 'general-web-search', available: true, coverage: 'general-web' }),
    search: async (): Promise<LiveSearchResult[]> => [
      {
        id: 'web:1',
        connectorId: 'general-web-search',
        title: 'A community answer',
        url: 'https://search.example.com/a',
        domain: 'search.example.com',
        retrievedAt: NOW,
        trustTier: 3,
        sourceType: 'general-web',
      },
    ],
    fetch: async () => {
      throw new Error('a domain-less connector must be routed through the generic fetch');
    },
  };
  const registry = new LiveConnectorRegistry().register(web, ['web']);

  const out = await researchLive({ mode: 'web', query: 'anything at all' }, researchDeps(registry, deps.fetch.fetchImpl!));

  assert.equal(out.decision.broadWebCoverage, true);
  assert.match(buildLiveKnowledgeFrame(out).headline, /Live knowledge: Web research/);
  // And official must still refuse the same Tier 3 source.
  const official = await researchLive({ mode: 'official', query: 'anything at all' }, researchDeps(registry, impl));
  assert.equal(official.documents.length, 0);
  assert.equal(official.decision.broadWebCoverage, false, 'a web-only connector is not eligible for official');
});

// ── citations bind to accepted sources ───────────────────────────────────────

test('citations correspond exactly to accepted source ids', async () => {
  const { impl } = apiStub([
    { match: '/releases/latest', body: RELEASE },
    { match: 'api.github.com/repos/nodejs/node', body: { full_name: 'nodejs/node', default_branch: 'main' } },
    { match: 'registry.npmjs.org', body: NPM_DOC },
  ]);
  const deps = connectorDeps(impl);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createGitHubConnector(deps), createNpmConnector(deps)]);

  const out = await researchLive(
    { mode: 'official', query: 'latest release of nodejs/node and the npm typescript version' },
    researchDeps(registry, impl),
  );
  const frame = buildLiveKnowledgeFrame(out);

  assert.deepEqual(
    frame.citations.map((c) => c.sourceId).sort(),
    out.documents.map((d) => d.source.id).sort(),
    'one citation per fetched document, no more and no fewer',
  );
  assert.equal(frame.sourcesAccepted, out.documents.length);
  for (const c of frame.citations) {
    assert.ok(c.contentHash.length > 0, 'every citation is attributable to content');
    assert.ok(c.connectorId.length > 0);
    assert.ok(!c.safeUrl.includes('?'), 'no query string in a rendered URL');
  }
});

test('a rejected source id can never appear in citations', async () => {
  const { impl } = apiStub([
    { match: 'registry.npmjs.org', body: NPM_DOC },
    { match: 'api.github.com', status: 500 },
  ]);
  const deps = connectorDeps(impl);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createGitHubConnector(deps), createNpmConnector(deps)]);

  const out = await researchLive(
    { mode: 'official', query: 'latest release of nodejs/node and npm typescript' },
    researchDeps(registry, impl),
  );
  const ids = buildLiveKnowledgeFrame(out).citations.map((c) => c.sourceId);

  assert.ok(ids.length > 0, 'the working connector produced citations');
  assert.ok(!ids.some((id) => id.startsWith('github:')), 'the failed GitHub fetches are uncitable');
  assert.ok(Object.keys(out.rejections).some((k) => k === 'http-error'), 'and their failure is recorded');
});

test('citations are derived from documents, so a fabricated id cannot enter', () => {
  const citations = buildCitations([
    {
      source: {
        id: 'real:1',
        connectorId: NPM_CONNECTOR_ID,
        title: 'npm typescript',
        url: 'https://registry.npmjs.org/typescript?token=SECRET',
        domain: 'registry.npmjs.org',
        retrievedAt: NOW,
        trustTier: 1,
        sourceType: 'official-api',
      },
      content: 'latest: 6.2.0',
      contentHash: 'deadbeef',
      fetchedAt: NOW,
    },
  ]);

  assert.deepEqual(citations.map((c) => c.sourceId), ['real:1']);
  assert.equal(citations[0]!.safeUrl, 'https://registry.npmjs.org/typescript');
  assert.ok(!JSON.stringify(citations).includes('SECRET'));
});

// ── frame ordering and audit ─────────────────────────────────────────────────

test('provenance renders before answer content', async () => {
  const { impl } = apiStub([{ match: 'registry.npmjs.org', body: NPM_DOC }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);

  const out = await researchLive({ mode: 'official', query: 'npm typescript latest' }, researchDeps(registry, impl));
  const rendered = renderLiveKnowledgeFrame(buildLiveKnowledgeFrame(out));
  const transcript = `${rendered}\n\nThe current version is 6.2.0.`;

  const lines = rendered.split('\n');
  assert.equal(lines[0], 'Live knowledge: Official sources');
  assert.match(lines[1]!, /^Checked: /);
  assert.equal(lines[2], 'Sources consulted: 1');
  assert.equal(lines[3], 'Sources accepted: 1');
  assert.ok(
    transcript.indexOf('Live knowledge:') < transcript.indexOf('The current version'),
    'the frame precedes the answer',
  );
  // Host-rendered, so it exists whether or not the model chose to mention its sources.
  assert.match(rendered, /\[npm:typescript\]/);
});

test('the frame names unavailable connectors for the operator', async () => {
  const { impl } = apiStub([{ match: 'registry.npmjs.org', body: NPM_DOC }]);
  const deps = connectorDeps(impl);
  const registry = new LiveConnectorRegistry().registerAuthoritative([
    createNpmConnector(deps),
    createVendorDocsConnector(deps, []),
  ]);

  const out = await researchLive({ mode: 'official', query: 'npm typescript latest' }, researchDeps(registry, impl));
  const frame = buildLiveKnowledgeFrame(out);

  const docs = frame.unavailable.find((u) => u.connectorId === VENDOR_DOCS_CONNECTOR_ID)!;
  assert.equal(docs.reason, 'not-configured');
  assert.match(renderLiveKnowledgeFrame(frame), /unavailable: vendor-docs \(not-configured\)/);
});

test('the audit stays free of query text, bodies, snippets, tokens and sensitive parameters', async () => {
  const { impl } = apiStub([{ match: 'registry.npmjs.org', body: { ...NPM_DOC, description: 'BODY_SENTINEL_TEXT' } }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative([
    createGitHubConnector(connectorDeps(impl, { GITHUB_TOKEN: 'ghp_TOKEN_SENTINEL' })),
    createNpmConnector(connectorDeps(impl)),
  ]);

  const out = await researchLive(
    { mode: 'official', query: 'npm typescript for CLIENT_NAME with key SK_LIVE_SENTINEL' },
    researchDeps(registry, impl),
  );
  const serialised = JSON.stringify(liveResearchAuditFields(out, { startedAt: NOW, durationMs: 11 }));

  for (const forbidden of [
    'SK_LIVE_SENTINEL',   // a secret pasted into the question
    'CLIENT_NAME',        // customer identity from the prompt
    'BODY_SENTINEL_TEXT', // retrieved content
    'ghp_TOKEN_SENTINEL', // a configured credential
    'typescript for',     // the query itself
    'Authorization',
  ]) {
    assert.ok(!serialised.includes(forbidden), `audit must not contain ${forbidden}: ${serialised}`);
  }
  // The metadata an operator acts on is still there.
  assert.match(serialised, /registry\.npmjs\.org/);
  assert.match(serialised, /official-sources-used/);
  assert.match(serialised, /contentHash/);
});

// ── the two evidence dimensions stay independent ─────────────────────────────

test('repository grounding and live knowledge operate independently in one turn', async () => {
  const { decideGrounding, DEFAULT_MIN_APPROVED_SCORE } = await import('../src/engine/grounding/groundingDecision.js');
  const { impl } = apiStub([{ match: 'registry.npmjs.org', body: NPM_DOC }]);
  const registry = new LiveConnectorRegistry().registerAuthoritative([createNpmConnector(connectorDeps(impl))]);

  // Repository evidence explicitly OFF, live knowledge explicitly ON.
  const grounding = await decideGrounding(
    { mode: 'none', query: 'npm typescript latest' },
    {
      approvedIndexId: () => {
        throw new Error('none mode must not consult the approved index');
      },
      retrieveApproved: async () => {
        throw new Error('none mode must not query the index');
      },
      indexIdentity: () => {
        throw new Error('none mode must not read index identity');
      },
      minScore: DEFAULT_MIN_APPROVED_SCORE,
    },
  );
  const live = await researchLive({ mode: 'official', query: 'npm typescript latest' }, researchDeps(registry, impl));

  assert.equal(grounding.mode, 'none');
  assert.equal(live.documents.length, 1, 'live research is unaffected by repository mode none');

  // And the calibrated floor is untouched by anything in this slice.
  assert.equal(DEFAULT_MIN_APPROVED_SCORE, 0.53);
});

test('every default connector declares its domains and its credential names only', () => {
  const { impl } = apiStub([{ match: 'x', body: {} }]);
  const connectors = buildAuthoritativeConnectors(connectorDeps(impl, { GITHUB_TOKEN: 'ghp_SECRET' }));

  assert.deepEqual(
    connectors.map((c) => c.id),
    [GITHUB_CONNECTOR_ID, NPM_CONNECTOR_ID, PYPI_CONNECTOR_ID, OCI_CONNECTOR_ID, ADVISORY_CONNECTOR_ID, VENDOR_DOCS_CONNECTOR_ID, STATUS_CONNECTOR_ID],
  );
  for (const c of connectors) {
    assert.equal(c.coverage, 'authoritative', `${c.id} must not claim general web coverage`);
    assert.ok(c.domains.length > 0, `${c.id} declares no domains`);
    for (const cred of c.credentials ?? []) {
      assert.match(cred.envVar, /^[A-Z][A-Z0-9_]*$/, 'a variable NAME, not a value');
    }
    // The declared surface never carries a secret, so it is safe to log wholesale.
    const described = JSON.stringify({ id: c.id, domains: c.domains, credentials: c.credentials, availability: c.availability() });
    assert.ok(!described.includes('ghp_SECRET'), `${c.id} leaked a credential value`);
  }
});
