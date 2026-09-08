/**
 * THE SEARXNG ADAPTER — tested against recorded payloads, with no backend.
 *
 * Written before `migra-search-core` exists, deliberately: the translation is
 * the part that must be right, and it has to keep working when the backend is
 * DOWN. Every failure path below is a state the live system will reach.
 *
 * The boundary claim these tests defend: deleting this adapter and writing a
 * different one should require no change anywhere else in the codebase.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ENGINES, SearxngProvider, type SearxngConfig } from '../src/engine/search/searxngProvider.js';
import type { SearchRequest } from '../src/engine/search/types.js';

const CONFIG: SearxngConfig = {
  baseUrl: 'http://search.internal:8080',
  engines: DEFAULT_ENGINES,
  maxTimeoutMs: 10_000,
};

const REQUEST: SearchRequest = {
  query: 'council transit plan',
  limit: 5,
  freshness: 'any',
  safeSearch: 'moderate',
  timeoutMs: 5000,
};

/** A recorded SearXNG payload. Shape copied from its JSON API. */
const PAYLOAD = {
  query: 'council transit plan',
  number_of_results: 3,
  results: [
    {
      url: 'https://www.originalpaper.com/transit?utm_source=searxng',
      title: 'Council approves transit plan',
      content: 'The council approved the plan after consultation.',
      engine: 'duckduckgo',
      publishedDate: '2026-03-04T09:30:00Z',
      score: 1.5,
    },
    {
      url: 'https://aggregator.com/story',
      title: 'Transit plan approved',
      content: 'The council approved the plan after consultation.',
      engine: 'bing',
      publishedDate: null,
      score: 0.9,
    },
  ],
};

function provider(over: {
  respond?: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  now?: () => number;
} = {}) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    if (over.respond) return over.respond();
    return { ok: true, status: 200, json: async () => PAYLOAD };
  };
  return { provider: new SearxngProvider(CONFIG, fetchImpl, over.now), calls };
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

test('SearXNG rows become canonical Migra results', async () => {
  const { provider: p } = provider();
  const outcome = await p.search(REQUEST);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const [first] = outcome.results;
  assert.equal(first!.title, 'Council approves transit plan');
  assert.equal(first!.domain, 'originalpaper.com');
  assert.ok(!first!.canonicalUrl.includes('utm_source'), 'tracking parameters survived into the canonical URL');
  assert.equal(first!.publishedAt, '2026-03-04T09:30:00.000Z');
  assert.equal(first!.provider, 'searxng');
});

test('providerRank is the row POSITION, not SearXNG’s score', () => {
  /*
   * The score is a blend of upstream engine weights whose scale is not stable
   * across queries or versions — the ordering it produces is meaningful, its
   * magnitude is not. Migra ranking wants a position.
   */
  return provider()
    .provider.search(REQUEST)
    .then((outcome) => {
      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;
      assert.deepEqual(outcome.results.map((r) => r.providerRank), [0, 1]);
    });
});

test('🚨 a missing or unparseable date stays ABSENT, never guessed', async () => {
  const { provider: p } = provider({
    respond: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { url: 'https://a.com/1', title: 'A', content: 'x', publishedDate: null },
          { url: 'https://b.com/2', title: 'B', content: 'x', publishedDate: 'not a date' },
        ],
      }),
    }),
  });
  const outcome = await p.search(REQUEST);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  for (const r of outcome.results) {
    assert.equal(r.publishedAt, undefined, 'a date was invented from an absent or broken value');
  }
});

test('a row with no URL is dropped rather than carried as empty', async () => {
  const { provider: p } = provider({
    respond: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: 'No URL', content: 'x' }, { url: 'https://ok.com/1', title: 'Fine' }] }),
    }),
  });
  const outcome = await p.search(REQUEST);
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.results.length, 1);
});

test('the caller’s limit is honoured', async () => {
  const many = { results: Array.from({ length: 40 }, (_, i) => ({ url: `https://x.com/${i}`, title: `T${i}`, content: 'c' })) };
  const { provider: p } = provider({ respond: async () => ({ ok: true, status: 200, json: async () => many }) });
  const outcome = await p.search({ ...REQUEST, limit: 5 });
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.results.length, 5);
});

/* ------------------------------------------------------------------ *
 * 🚨 Failure mapping — the part that must never collapse
 * ------------------------------------------------------------------ */

test('🚨 a transport error is provider_unavailable, NOT no_results', async () => {
  /*
   * The single most damaging thing this adapter could do. "The backend refused
   * the connection" and "the web contains nothing about this" are opposite
   * claims, and only one of them is something we learned.
   */
  const { provider: p } = provider({
    respond: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const outcome = await p.search(REQUEST);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'provider_unavailable');
});

test('🚨 a 429 is provider_unavailable, not an empty web', async () => {
  // SearXNG returns 429 when upstreams rate-limit it. Reporting that as "no
  // results" tells the user the world is empty because we asked too fast.
  const { provider: p } = provider({ respond: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  const outcome = await p.search(REQUEST);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'provider_unavailable');
});

test('an abort becomes provider_timeout, distinct from unavailable', async () => {
  const { provider: p } = provider({
    respond: async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    },
  });
  const outcome = await p.search(REQUEST);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'provider_timeout');
});

test('🚨 a 200 with an unrecognised shape is a BROKEN backend, not nothing found', async () => {
  // Treating unparseable output as "no results" hides a misconfiguration
  // behind a plausible answer.
  for (const body of [{}, { results: 'not an array' }, null, 'a string']) {
    const { provider: p } = provider({ respond: async () => ({ ok: true, status: 200, json: async () => body }) });
    const outcome = await p.search(REQUEST);
    assert.equal(outcome.ok, false, `shape ${JSON.stringify(body)} was accepted`);
    if (!outcome.ok) assert.equal(outcome.failure.kind, 'provider_unavailable');
  }
});

test('🚨 an EMPTY result list is the only thing that yields no_results', async () => {
  const { provider: p } = provider({ respond: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }) });
  const outcome = await p.search(REQUEST);
  assert.equal(outcome.ok, true, 'an empty answer was reported as a failure');
  if (outcome.ok) assert.deepEqual(outcome.results, []);
});

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */

test('health uses the liveness endpoint and performs NO search', async () => {
  const { provider: p, calls } = provider({ respond: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  const health = await p.health();
  assert.equal(health.ready, true);
  assert.equal(calls.length, 1);
  /*
   * Asserted on the PATH, not a substring of the whole URL. The first version
   * checked `!url.includes('/search')` and failed against a base URL of
   * `http://search.internal:8080` — because `//search.internal` contains
   * `/search`. The code was right; the assertion was matching the hostname.
   */
  const probe = new URL(calls[0]!);
  assert.equal(probe.pathname, '/healthz', 'health ran a query instead of a liveness check');
  assert.notEqual(probe.pathname, '/search', 'health spent search capacity');
});

test('an unhealthy backend reports the ENGINE’s words, not the status line', async () => {
  const { provider: p } = provider({ respond: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  const health = await p.health();
  assert.equal(health.ready, false);
  assert.equal(health.reason, 'Web search is unavailable right now.');
});

/* ------------------------------------------------------------------ *
 * 🚨 Containment — nothing SearXNG-shaped escapes
 * ------------------------------------------------------------------ */

test('🚨 no failure or health output names the backend, its host, or its port', async () => {
  /*
   * The cold-start defect, in the place it would be easiest to reintroduce.
   * These strings reach a user through the capability's unavailable reason.
   */
  const cases = [
    provider({ respond: async () => { throw new Error('connect ECONNREFUSED search.internal:8080'); } }),
    provider({ respond: async () => ({ ok: false, status: 503, json: async () => ({}) }) }),
  ];
  for (const { provider: p } of cases) {
    const health = await p.health();
    const text = health.reason ?? '';
    for (const leak of ['searxng', 'SearXNG', 'search.internal', '8080', 'ECONNREFUSED']) {
      assert.ok(!text.includes(leak), `health reason leaked "${leak}": ${text}`);
    }
  }
});

test('the engine list is explicit and short', () => {
  /*
   * Enabling everything SearXNG supports raises result COUNT while quality
   * falls and latency rises: the long tail rate-limits, breaks quietly, and
   * returns the same syndicated pages the short list already found.
   */
  assert.ok(DEFAULT_ENGINES.length > 0, 'no engines configured');
  assert.ok(DEFAULT_ENGINES.length <= 8, `${DEFAULT_ENGINES.length} engines — the long tail costs more than it returns`);
});

test('the request carries the configured engines and a freshness window', async () => {
  const { provider: p, calls } = provider();
  await p.search({ ...REQUEST, freshness: 'latest' });
  const url = calls[0]!;
  assert.match(url, /engines=/, 'engines were not pinned — SearXNG would use its defaults');
  assert.match(url, /time_range=week/, 'a "latest" request carried no freshness window');
});

test('an evergreen request carries NO time window', async () => {
  // Narrowing an evergreen query by date would hide the best answer because it
  // is old, which is the opposite of what freshness is for.
  const { provider: p, calls } = provider();
  await p.search({ ...REQUEST, freshness: 'any' });
  assert.ok(!calls[0]!.includes('time_range'), 'an evergreen query was date-restricted');
});
