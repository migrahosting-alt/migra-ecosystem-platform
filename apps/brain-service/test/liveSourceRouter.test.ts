/**
 * Choosing a retrieval provider, and surviving one.
 *
 * The property under test is vendor-independence: the same turn must be
 * satisfiable by different services, and losing one must not lose the feature.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeLiveSource, searchWithFallback, NoLiveSourceProvider,
} from '../src/engine/live/liveSourceRouter.js';
import {
  LiveSourceUnavailable,
  type LiveSourceCapabilities, type LiveSourceProvider, type LiveSourceResult,
} from '../src/engine/live/liveSourceProvider.js';

const caps = (over: Partial<LiveSourceCapabilities> = {}): LiveSourceCapabilities => ({
  returnsExtractedContent: false,
  returnsPublishDates: false,
  supportsFreshnessFilter: false,
  commercialUseCleared: true,
  ...over,
});

function provider(
  id: string,
  options: {
    capabilities?: Partial<LiveSourceCapabilities>;
    qualification?: 'approved' | 'unqualified' | 'rejected';
    cost?: number;
    fails?: LiveSourceUnavailable;
    results?: number;
  } = {},
): LiveSourceProvider {
  return {
    descriptor: {
      id,
      label: id,
      capabilities: caps(options.capabilities),
      qualification: options.qualification ?? 'approved',
      costPerQueryCents: options.cost ?? 0,
    },
    async search(): Promise<LiveSourceResult> {
      if (options.fails) throw options.fails;
      const n = options.results ?? 1;
      return {
        provider: id,
        latencyMs: 1,
        sources: Array.from({ length: n }, (_, i) => ({
          url: `https://example.test/${id}/${i}`,
          title: `${id} result ${i}`,
          provider: id,
          rank: i,
        })),
      };
    },
  };
}

test('a provider that cannot quote is excluded when the answer must quote', () => {
  /*
   * Synthesising from snippets while citing pages is how a confident,
   * unsupported sentence gets a footnote. So this is a hard filter, not a bias.
   */
  const linksOnly = provider('links-only');
  const extracts = provider('extracts', { capabilities: { returnsExtractedContent: true } });

  const decision = routeLiveSource([linksOnly, extracts], { needsQuotableContent: true });
  assert.equal(decision.provider.descriptor.id, 'extracts');
  assert.deepEqual(decision.excluded, [{ id: 'links-only', reason: 'returns no quotable content' }]);
});

test('commercial licensing is a hard gate in BOTH modes', () => {
  /*
   * An evaluation is not a licence. A provider we may not ship must never be one
   * wrong flag away from serving a user.
   */
  const unlicensed = provider('unlicensed', { capabilities: { commercialUseCleared: false } });

  for (const mode of ['production', 'evaluation'] as const) {
    assert.throws(() => routeLiveSource([unlicensed], { mode }), NoLiveSourceProvider, mode);
  }
});

test('an unqualified provider serves evaluation but never production', () => {
  const candidate = provider('candidate', { qualification: 'unqualified' });

  assert.throws(() => routeLiveSource([candidate], { mode: 'production' }), NoLiveSourceProvider);
  assert.equal(
    routeLiveSource([candidate], { mode: 'evaluation' }).provider.descriptor.id,
    'candidate',
  );
});

test('a rejected provider never serves, in any mode', () => {
  const bad = provider('rejected-one', { qualification: 'rejected' });
  for (const mode of ['production', 'evaluation'] as const) {
    assert.throws(() => routeLiveSource([bad], { mode }), NoLiveSourceProvider, mode);
  }
});

test('capability outranks cost', () => {
  /*
   * The cheapest provider that cannot do the job is not cheap — it is a wasted
   * round trip followed by a worse answer.
   */
  const cheapButThin = provider('cheap', { cost: 0 });
  const capableButPaid = provider('capable', {
    cost: 5,
    capabilities: { returnsExtractedContent: true, returnsPublishDates: true },
  });

  const decision = routeLiveSource([cheapButThin, capableButPaid]);
  assert.equal(decision.provider.descriptor.id, 'capable');
  assert.equal(decision.fallbacks[0]!.descriptor.id, 'cheap', 'the cheap one is still a fallback');
});

test('cost breaks a tie between equally capable providers', () => {
  const paid = provider('paid', { cost: 9, capabilities: { returnsExtractedContent: true } });
  const free = provider('free', { cost: 0, capabilities: { returnsExtractedContent: true } });

  assert.equal(routeLiveSource([paid, free]).provider.descriptor.id, 'free');
});

test('the feature survives losing a provider', () => {
  // The whole reason for the contract: one vendor failing is not the feature failing.
  /*
   * Rank is decided by capability, not by array position — so the one that is
   * meant to be tried FIRST is given the advantage explicitly. An earlier
   * version relied on argument order and silently tested nothing, because the
   * router had already sorted the healthy provider to the front.
   */
  const dead = provider('dead', {
    capabilities: { returnsExtractedContent: true },
    fails: new LiveSourceUnavailable('dead', 'rate_limited', 'slow down'),
  });
  const alive = provider('alive');

  return searchWithFallback([dead, alive], { query: 'anything' }).then((outcome) => {
    assert.equal(outcome.provider, 'alive');
    assert.deepEqual(outcome.attempted, [{ id: 'dead', code: 'rate_limited' }]);
  });
});

test('zero results is an ANSWER, not a failure to fall past', async () => {
  /*
   * Treating "nothing found" as a failure would send the same query to every
   * vendor in turn and present whichever one produced something — which is the
   * opposite of retrieval.
   */
  const empty = provider('empty', { results: 0, capabilities: { returnsExtractedContent: true } });
  const chatty = provider('chatty', { results: 5 });

  const outcome = await searchWithFallback([empty, chatty], { query: 'obscure' });
  assert.equal(outcome.provider, 'empty');
  assert.equal(outcome.sources.length, 0);
  assert.deepEqual(outcome.attempted, [], 'nothing was tried past');
});

test('when every provider fails, the last error is raised rather than swallowed', async () => {
  const a = provider('a', { fails: new LiveSourceUnavailable('a', 'timeout', 'took too long') });
  const b = provider('b', { fails: new LiveSourceUnavailable('b', 'auth', 'bad key') });

  await assert.rejects(() => searchWithFallback([a, b], { query: 'x' }), /bad key/);
});

test('the routing record explains an empty outcome', () => {
  // "No provider was available" is useless without which ones and why.
  const filtered = provider('links', {});
  try {
    routeLiveSource([filtered], { needsQuotableContent: true });
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof NoLiveSourceProvider);
    assert.deepEqual(error.excluded, [{ id: 'links', reason: 'returns no quotable content' }]);
  }
});
