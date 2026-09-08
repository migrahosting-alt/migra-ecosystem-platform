/**
 * READINESS AND FAILURE STATES — the distinctions that must never collapse.
 *
 * There are four different things that all end up looking like "search didn't
 * work", and each calls for something different from the person reading it:
 *
 *   not_configured        nobody has set up a backend      → set one up
 *   provider_unavailable  it exists and is not answering   → wait, or check it
 *   provider_timeout      it answered too slowly           → try again
 *   no_results            it worked; there is nothing      → ask differently
 *
 * Only the last is a claim about the WORLD. Collapsing any of the first three
 * into "I couldn't find anything" tells the user something we never learned.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CapabilityRegistry, LOCAL_GRANTS } from '../src/engine/models/capabilityRegistry.js';
import { MigraSearch, SEARCH_NOT_CONFIGURED, SEARCH_UNAVAILABLE } from '../src/engine/search/migraSearch.js';
import type { ProviderHealth, SearchOutcome, SearchProvider, SearchRequest } from '../src/engine/search/types.js';

const REQUEST: SearchRequest = {
  query: 'latest transit plan',
  limit: 5,
  freshness: 'latest',
  safeSearch: 'moderate',
  timeoutMs: 5000,
};

function provider(over: Partial<SearchProvider> = {}): SearchProvider {
  return {
    id: 'test-provider',
    search: async (): Promise<SearchOutcome> => ({ ok: true, results: [], provider: 'test-provider', tookMs: 1 }),
    health: async (): Promise<ProviderHealth> => ({ ready: true, checkedAt: new Date().toISOString() }),
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * The four states
 * ------------------------------------------------------------------ */

test('🚨 no provider is NOT_CONFIGURED, and says so', () => {
  const search = new MigraSearch();
  const readiness = search.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, SEARCH_NOT_CONFIGURED);
  assert.equal(search.configured, false);
});

test('🚨 not_configured is a distinct FAILURE KIND from unavailable', async () => {
  const search = new MigraSearch();
  const outcome = await search.search(REQUEST);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'not_configured');
});

test('🚨 a provider that is configured but unhealthy is UNAVAILABLE, not unconfigured', async () => {
  /*
   * "Nobody set it up" and "it is set up and not answering" call for opposite
   * actions. A user shown the first when the second is true goes looking for a
   * setting that is already correct.
   */
  const search = new MigraSearch({
    provider: provider({
      health: async () => ({ ready: false, reason: SEARCH_UNAVAILABLE, checkedAt: new Date().toISOString() }),
    }),
  });
  assert.equal(search.configured, true, 'a configured provider must not read as unconfigured');
  await search.refreshHealth();
  const readiness = search.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, SEARCH_UNAVAILABLE);
  assert.notEqual(readiness.reason, SEARCH_NOT_CONFIGURED);
});

test('a provider that throws on search reports provider_unavailable', async () => {
  const search = new MigraSearch({
    provider: provider({
      search: async () => {
        throw new Error('ECONNREFUSED 10.10.0.99:8080');
      },
    }),
  });
  const outcome = await search.search(REQUEST);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'provider_unavailable');
});

test('🚨 an empty result set is NO_RESULTS, never a failure of the provider', async () => {
  // The only one of the four that is a claim about the world.
  const search = new MigraSearch({ provider: provider() });
  const outcome = await search.search(REQUEST);
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.deepEqual(outcome.results, []);
});

test('a timeout is its own kind, distinct from unavailable', async () => {
  const search = new MigraSearch({
    provider: provider({
      search: async () => ({
        ok: false,
        failure: { kind: 'provider_timeout', waitedMs: 5000 },
        provider: 'test-provider',
        tookMs: 5000,
      }),
    }),
  });
  const outcome = await search.search(REQUEST);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'provider_timeout');
});

test('🚨 the four states produce four DIFFERENT observable outcomes', async () => {
  /*
   * An earlier version of this test declared a set of four literals and
   * asserted its size — it would have passed against any implementation,
   * including one that returned the same kind for everything. That is the
   * self-referential shape this repository has been bitten by, so it is gone.
   *
   * This drives the real code down each path and collects what a caller would
   * actually observe. Merging any two states collapses the set.
   */
  const observed: string[] = [];

  const unconfigured = await new MigraSearch().search(REQUEST);
  observed.push(unconfigured.ok ? 'ok' : unconfigured.failure.kind);

  const unavailable = await new MigraSearch({
    provider: provider({ search: async () => { throw new Error('down'); } }),
  }).search(REQUEST);
  observed.push(unavailable.ok ? 'ok' : unavailable.failure.kind);

  const timedOut = await new MigraSearch({
    provider: provider({
      search: async () => ({ ok: false, failure: { kind: 'provider_timeout', waitedMs: 1 }, provider: 'p', tookMs: 1 }),
    }),
  }).search(REQUEST);
  observed.push(timedOut.ok ? 'ok' : timedOut.failure.kind);

  const empty = await new MigraSearch({ provider: provider() }).search(REQUEST);
  observed.push(empty.ok && empty.results.length === 0 ? 'no_results' : 'other');

  assert.deepEqual(observed, ['not_configured', 'provider_unavailable', 'provider_timeout', 'no_results']);
  assert.equal(new Set(observed).size, 4, 'two states collapsed into one observable outcome');
});

/* ------------------------------------------------------------------ *
 * Disclosure
 * ------------------------------------------------------------------ */

test('🚨 no user-facing reason names a backend, host or version', async () => {
  /*
   * The cold-start defect, in a new place. "SearXNG at 10.10.0.99 refused the
   * connection" is infrastructure describing itself to someone who asked about
   * restaurants. The exception's own message must not become the reason.
   */
  const search = new MigraSearch({
    provider: provider({
      health: async () => {
        throw new Error('connect ECONNREFUSED 10.10.0.99:8080 (searxng)');
      },
    }),
  });
  const health = await search.refreshHealth();
  const text = `${health.reason ?? ''} ${search.readiness().reason ?? ''}`;
  for (const leak of ['searxng', 'SearXNG', '10.10.0.99', 'ECONNREFUSED', '8080']) {
    assert.ok(!text.includes(leak), `a user-facing reason leaked "${leak}": ${text}`);
  }
});

/* ------------------------------------------------------------------ *
 * Health caching — readiness must be free
 * ------------------------------------------------------------------ */

test('readiness never performs a search', async () => {
  let searches = 0;
  const search = new MigraSearch({
    provider: provider({
      search: async () => {
        searches += 1;
        return { ok: true, results: [], provider: 'test-provider', tookMs: 1 };
      },
    }),
  });
  for (let i = 0; i < 50; i += 1) search.readiness();
  assert.equal(searches, 0, 'drawing a menu spent provider quota');
});

test('a stale snapshot reports READY rather than hiding a working capability', () => {
  /*
   * Optimism is correct here. If the provider really is down, the search fails
   * truthfully a moment later; a pessimistic stale reading would hide a
   * capability that works, which the user cannot diagnose at all.
   */
  let clock = 0;
  const search = new MigraSearch({ provider: provider(), now: () => clock });
  clock = 1000;
  void search.refreshHealth();
  clock = 1000 + 61_000;
  assert.equal(search.readiness().ready, true);
});

/* ------------------------------------------------------------------ *
 * Registry integration
 * ------------------------------------------------------------------ */

test('🚨 migra.search is REGISTERED even with no provider', () => {
  /*
   * Omitting it until a backend exists would teach people the product cannot
   * search — a different and worse untruth than "not set up yet".
   */
  const registry = new CapabilityRegistry(LOCAL_GRANTS);
  const listed = registry.list({ includeUnavailable: true }).find((c) => c.id === 'migra.search');
  assert.ok(listed, 'migra.search is not registered');
  assert.equal(listed.readOnly, true);
  assert.equal(listed.approvalRequired, false, 'ordinary web search must not require consent');
});

test('🚨 it reports UNAVAILABLE with the engine’s own reason', () => {
  const registry = new CapabilityRegistry(LOCAL_GRANTS);
  const listed = registry.list({ includeUnavailable: true }).find((c) => c.id === 'migra.search');
  assert.equal(listed!.available, false, 'search claims to be available with no provider');
  assert.equal(listed!.unavailableReason, SEARCH_NOT_CONFIGURED);
});

test('the reason is absent when a capability IS available', () => {
  // A reason attached to a working capability would render as an excuse for
  // something that has nothing wrong with it.
  const registry = new CapabilityRegistry(LOCAL_GRANTS);
  const available = registry.list().find((c) => c.available);
  assert.ok(available, 'no capability is available at all');
  assert.equal(available.unavailableReason, undefined);
});

test('a missing GRANT gets no user-facing reason', () => {
  /*
   * terminal.exec is unavailable because a grant is withheld — an internal
   * deployment fact. "You lack terminal.exec" is scaffolding, not something a
   * person can act on, so it is deliberately not surfaced.
   */
  const registry = new CapabilityRegistry(LOCAL_GRANTS);
  const terminal = registry.list({ includeUnavailable: true }).find((c) => c.id === 'terminal.exec');
  assert.ok(terminal);
  assert.equal(terminal.available, false);
  assert.equal(terminal.unavailableReason, undefined);
});

test('an unavailable capability is omitted from the DEFAULT listing', () => {
  // Clients that want the honest catalog ask for it explicitly; the default
  // stays "what can run right now".
  const registry = new CapabilityRegistry(LOCAL_GRANTS);
  assert.equal(registry.list().find((c) => c.id === 'migra.search'), undefined);
  assert.ok(registry.list({ includeUnavailable: true }).find((c) => c.id === 'migra.search'));
});
