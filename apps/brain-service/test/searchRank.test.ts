/**
 * MIGRA-OWNED RANKING — the first place our judgement replaces the provider's.
 *
 * These are the fixtures the work order names, and they assert ORDER and
 * DIRECTION rather than exact totals. A test pinning a score to three decimal
 * places breaks on every tuning change while proving nothing about behaviour,
 * and would make the weights untouchable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { rankResults, weightsFor, WEIGHTS, type RankInput } from '../src/engine/search/rank.js';
import type { SearchResult } from '../src/engine/search/types.js';

const NOW = Date.parse('2026-09-08T00:00:00.000Z');

function result(over: Partial<SearchResult> & { url: string; providerRank: number }): SearchResult {
  const url = over.url;
  return {
    title: 'A page',
    snippet: 'Some text about the subject.',
    canonicalUrl: url,
    domain: new URL(url).hostname,
    provider: 'test',
    retrievedAt: '2026-09-08T00:00:00.000Z',
    ...over,
  } as SearchResult;
}

const rank = (input: Omit<RankInput, 'now'>) => rankResults({ ...input, now: () => NOW });
const order = (input: Omit<RankInput, 'now'>) => rank(input).map((r) => r.result.domain);

/* ------------------------------------------------------------------ *
 * Fixture: official documentation vs a scraped tutorial
 * ------------------------------------------------------------------ */

test('🚨 official docs outrank a tutorial that copied them', () => {
  /*
   * The provider put the tutorial FIRST — SEO usually does. Directness (the
   * subject is in the host) plus intent (a /docs/ path) has to be enough to
   * overturn that, or the ranker is decorative.
   */
  const results = [
    result({
      url: 'https://tutorialsite.com/blog/stripe-api-guide',
      title: 'Complete Stripe API tutorial for beginners',
      snippet: 'Learn the Stripe API with examples covering payments and webhooks.',
      providerRank: 0,
    }),
    result({
      url: 'https://stripe.com/docs/api',
      title: 'Stripe API reference',
      snippet: 'Complete reference for the Stripe API, payments and webhooks.',
      providerRank: 3,
    }),
  ];
  const ranked = order({ query: 'official docs for the Stripe API', results, freshness: 'any', intent: 'official_source_lookup' });
  assert.equal(ranked[0], 'stripe.com', `tutorial still won: ${ranked.join(' > ')}`);
});

test('directness is DERIVED from the query, not a blessed-domain list', () => {
  /*
   * The same code must rank a vendor nobody has heard of correctly on the day
   * they launch. If this passes only for known names, the ranker has a list in
   * it somewhere.
   */
  const results = [
    result({ url: 'https://someblog.com/posts/zergalix-setup', title: 'Setting up Zergalix', snippet: 'A guide to Zergalix configuration.', providerRank: 0 }),
    result({ url: 'https://zergalix.io/docs/start', title: 'Zergalix documentation', snippet: 'Official Zergalix configuration reference.', providerRank: 4 }),
  ];
  const ranked = order({ query: 'zergalix documentation', results, freshness: 'any', intent: 'official_source_lookup' });
  assert.equal(ranked[0], 'zergalix.io', `an unknown vendor was not recognised: ${ranked.join(' > ')}`);
});

/* ------------------------------------------------------------------ *
 * Fixture: original vs syndicated copy
 * ------------------------------------------------------------------ */

const SYNDICATED_BODY =
  'The council approved the new transit plan after eighteen months of public consultation and seven neighbourhood meetings.';

test('🚨 the original outranks its syndicated copies', () => {
  // Dedup cannot see this: different hosts, different headlines, same body.
  const results = [
    result({ url: 'https://aggregator-one.com/story-a', title: 'Transit plan gets green light', snippet: SYNDICATED_BODY, providerRank: 1 }),
    result({ url: 'https://originalpaper.com/transit-plan', title: 'Council approves transit plan', snippet: SYNDICATED_BODY, providerRank: 0 }),
    result({ url: 'https://aggregator-two.com/story-b', title: 'City transit plan approved', snippet: SYNDICATED_BODY, providerRank: 2 }),
  ];
  const ranked = order({ query: 'council transit plan approval', results, freshness: 'any' });
  assert.equal(ranked[0], 'originalpaper.com', `a syndicated copy won: ${ranked.join(' > ')}`);
});

test('🚨 two INDEPENDENT sources on one event both survive', () => {
  /*
   * The opposite failure. Two outlets covering the same event with their own
   * words are two sources, and penalising either as a duplicate would hide
   * genuine corroboration — which is worse than showing both.
   */
  const results = [
    result({ url: 'https://paper-a.com/transit', title: 'Council approves transit plan', snippet: 'The council voted 7-2 in favour of the transit proposal on Tuesday evening.', providerRank: 0 }),
    result({ url: 'https://paper-b.com/transit', title: 'Transit plan passes council vote', snippet: 'After lengthy debate the transit measure secured approval from city councillors.', providerRank: 1 }),
  ];
  const ranked = rank({ query: 'council transit plan', results, freshness: 'any' });
  for (const entry of ranked) {
    const originality = entry.components.find((c) => c.name === 'originality');
    assert.ok(
      originality!.score > 0.5,
      `${entry.result.domain} was penalised as a copy: ${originality!.reason}`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Fixture: freshness
 * ------------------------------------------------------------------ */

test('🚨 for a "latest" query, a recent page beats a stale authoritative one', () => {
  const results = [
    result({
      url: 'https://authority.com/guide',
      title: 'The definitive guide',
      snippet: 'Everything about the subject explained thoroughly.',
      providerRank: 0,
      publishedAt: '2019-01-01T00:00:00.000Z',
    }),
    result({
      url: 'https://recentnews.com/update',
      title: 'The definitive guide, updated',
      snippet: 'Everything about the subject explained thoroughly.',
      providerRank: 2,
      publishedAt: '2026-09-01T00:00:00.000Z',
    }),
  ];
  const ranked = order({ query: 'latest subject guide', results, freshness: 'latest' });
  assert.equal(ranked[0], 'recentnews.com', `a 2019 page won a "latest" query: ${ranked.join(' > ')}`);
});

test('🚨 for an EVERGREEN query, freshness does not reorder anything', () => {
  /*
   * "How does a hash map work" has a best answer that may be fifteen years old.
   * Letting recency intrude there actively degrades the result, so freshness
   * must be inert unless it was asked for.
   */
  const older = result({ url: 'https://classic.com/hashmaps', title: 'How hash maps work', snippet: 'Hash maps explained with collision handling and load factors.', providerRank: 0, publishedAt: '2011-01-01T00:00:00.000Z' });
  const newer = result({ url: 'https://recent.com/hashmaps', title: 'How hash maps work', snippet: 'Hash maps explained with collision handling and load factors.', providerRank: 1, publishedAt: '2026-09-01T00:00:00.000Z' });

  const evergreen = rank({ query: 'how do hash maps work', results: [older, newer], freshness: 'any' });
  for (const entry of evergreen) {
    const freshness = entry.components.find((c) => c.name === 'freshness');
    assert.equal(freshness!.score, 0.5, 'freshness influenced an evergreen query');
  }
  assert.equal(evergreen[0]!.result.domain, 'classic.com', 'provider order was overturned with no reason to');
});

test('🚨 an unknown date is NEUTRAL, never penalised', () => {
  // A page that did not state a date is not thereby old. Penalising silence
  // would systematically bury sources that simply do not publish metadata.
  const ranked = rank({
    query: 'latest transit news',
    results: [result({ url: 'https://nodate.com/a', providerRank: 0 })],
    freshness: 'latest',
  });
  const freshness = ranked[0]!.components.find((c) => c.name === 'freshness');
  assert.equal(freshness!.score, 0.5);
  assert.match(freshness!.reason, /not penalised/);
});

/* ------------------------------------------------------------------ *
 * Extraction quality
 * ------------------------------------------------------------------ */

test('🚨 a page we could not read falls, whatever else it scored', () => {
  /*
   * A multiplier rather than another weighted term, deliberately: an
   * unreadable page cannot support a citation, so its other virtues are
   * irrelevant rather than merely outweighed.
   */
  const good = result({ url: 'https://readable.com/a', title: 'Transit plan', snippet: 'The transit plan was approved.', providerRank: 3 });
  const unreadable = result({ url: 'https://jsapp.com/a', title: 'Transit plan', snippet: 'The transit plan was approved.', providerRank: 0 });
  const ranked = order({
    query: 'transit plan approved',
    results: [unreadable, good],
    freshness: 'any',
    extractionQuality: new Map([
      ['https://jsapp.com/a', 0.05],
      ['https://readable.com/a', 1],
    ]),
  });
  assert.equal(ranked[0], 'readable.com', `an unreadable page won: ${ranked.join(' > ')}`);
});

/* ------------------------------------------------------------------ *
 * Explainability and determinism
 * ------------------------------------------------------------------ */

test('every ranked result carries component scores and reasons', () => {
  // "Why is this third?" must be answerable from the data. A ranker that can
  // only be understood by re-reading its weights cannot be debugged when it is
  // subtly wrong, which is where a ranker spends most of its life.
  const ranked = rank({ query: 'transit plan', results: [result({ url: 'https://a.com/x', providerRank: 0 })], freshness: 'any' });
  const names = ranked[0]!.components.map((c) => c.name);
  for (const expected of ['providerRank', 'relevance', 'intent', 'directness', 'originality', 'freshness']) {
    assert.ok(names.includes(expected), `no component score for ${expected}`);
  }
  for (const component of ranked[0]!.components) {
    assert.ok(component.reason.length > 0, `${component.name} has no reason`);
    assert.ok(component.score >= 0 && component.score <= 1, `${component.name} is out of range`);
  }
});

test('ranking is deterministic — ties break on provider rank', () => {
  // Two identical results must not swap between runs, or a benchmark measures
  // noise instead of quality.
  const results = [
    result({ url: 'https://a.com/x', providerRank: 5 }),
    result({ url: 'https://b.com/x', providerRank: 2 }),
  ];
  const first = order({ query: 'unrelated terms entirely', results, freshness: 'any' });
  const second = order({ query: 'unrelated terms entirely', results, freshness: 'any' });
  assert.deepEqual(first, second);
  assert.equal(first[0], 'b.com', 'the better provider rank did not break the tie');
});

test('provider rank is an input, not the authority', () => {
  /*
   * If provider order always won, every fixture above would still pass by
   * accident where it happens to agree. This asserts the ranker CAN overturn
   * it — the property that makes the rest meaningful.
   */
  const results = [
    result({ url: 'https://irrelevant.com/a', title: 'Something else', snippet: 'Nothing to do with the question.', providerRank: 0 }),
    result({ url: 'https://transit.com/plan', title: 'Transit plan approved', snippet: 'The council approved the transit plan.', providerRank: 5 }),
  ];
  const ranked = order({ query: 'transit plan approved council', results, freshness: 'any' });
  assert.equal(ranked[0], 'transit.com', 'provider order was never overturned');
});

test('EVERY weight profile is named and sums to one', () => {
  /*
   * Not a magic-constant check — a guard that a new component was added
   * without anyone deciding what it costs the others, and that a profile was
   * not written by hand until it happened to pass one fixture.
   *
   * Checked across all profiles, because the first version of this test only
   * looked at the base table and would have missed a recency profile summing
   * to 1.4.
   */
  const profiles: Array<[string, Record<string, number>]> = [
    ['base', WEIGHTS as unknown as Record<string, number>],
    ['recency', weightsFor({ freshness: 'latest' })],
    ['recency-recent', weightsFor({ freshness: 'recent' })],
    ['official', weightsFor({ freshness: 'any', intent: 'official_source_lookup' })],
    ['general', weightsFor({ freshness: 'any', intent: 'general' })],
  ];
  for (const [name, profile] of profiles) {
    const total = Object.values(profile).reduce((sum, w) => sum + w, 0);
    assert.ok(Math.abs(total - 1) < 0.001, `${name} weights sum to ${total}, not 1`);
    for (const [component, weight] of Object.entries(profile)) {
      assert.ok(weight >= 0 && weight <= 1, `${name}.${component} is out of range: ${weight}`);
    }
  }
});

test('🚨 a recency question weights freshness above provider rank', () => {
  /*
   * The property the fixed table could not express, stated directly. If these
   * ever invert again, a 2019 page beats a week-old one on a query that said
   * "latest" — which is how this design flaw was found.
   */
  const recency = weightsFor({ freshness: 'latest' });
  assert.ok(
    recency.freshness > recency.providerRank,
    `freshness (${recency.freshness}) does not outweigh provider rank (${recency.providerRank})`,
  );
});

test('🚨 an official-source question weights directness above provider rank', () => {
  const official = weightsFor({ freshness: 'any', intent: 'official_source_lookup' });
  assert.ok(
    official.directness > official.providerRank,
    `directness (${official.directness}) does not outweigh provider rank (${official.providerRank})`,
  );
});

test('an evergreen general question gives freshness almost no weight', () => {
  // The opposite guard: recency must not creep into questions that never
  // asked for it.
  const general = weightsFor({ freshness: 'any', intent: 'general' });
  assert.ok(general.freshness <= 0.05, `freshness weighs ${general.freshness} on an evergreen question`);
});

test('an empty result set ranks to an empty list', () => {
  assert.deepEqual(rank({ query: 'anything', results: [], freshness: 'any' }), []);
});

/* ------------------------------------------------------------------ *
 * 🚨 ISOLATING FIXTURES — added because two mutations escaped
 *
 * Removing `directness` and removing the syndication penalty BOTH left all
 * sixteen tests green. The fixtures above were passing for the wrong reasons:
 * the docs case was carried by the /docs/ path matching intent, and the
 * syndication case by the original happening to hold the best provider rank.
 * Neither made the factor under test decisive.
 *
 * These hold every other component equal, so only the named factor can move
 * the outcome — and they assert the component score directly as well as the
 * order, because an order test can be satisfied by any term that happens to
 * agree.
 * ------------------------------------------------------------------ */

test('🚨 DIRECTNESS alone decides when everything else is equal', () => {
  /*
   * Same intent path, same query-term coverage, no dates. The only difference
   * is whether the subject appears in the HOST or merely in the path — and the
   * direct source deliberately has the WORSE provider rank, so directness must
   * overturn it or it is doing nothing.
   */
  const results = [
    result({
      url: 'https://someblog.com/docs/zergalix',
      title: 'Zergalix configuration walkthrough',
      snippet: 'A walkthrough covering zergalix configuration options in depth for beginners.',
      providerRank: 0,
    }),
    result({
      url: 'https://zergalix.io/docs/setup',
      title: 'Zergalix configuration',
      snippet: 'Reference for zergalix configuration parameters and defaults across releases.',
      providerRank: 3,
    }),
  ];
  const ranked = rank({ query: 'zergalix configuration', results, freshness: 'any', intent: 'official_source_lookup' });

  const direct = ranked.find((r) => r.result.domain === 'zergalix.io')!;
  const indirect = ranked.find((r) => r.result.domain === 'someblog.com')!;
  const directScore = direct.components.find((c) => c.name === 'directness')!;
  const indirectScore = indirect.components.find((c) => c.name === 'directness')!;

  assert.ok(
    directScore.score > indirectScore.score,
    `directness did not distinguish publisher from commentator: ${directScore.score} vs ${indirectScore.score}`,
  );
  assert.equal(
    ranked[0]!.result.domain,
    'zergalix.io',
    `directness did not overturn a better provider rank: ${ranked.map((r) => r.result.domain).join(' > ')}`,
  );
});

test('🚨 the SYNDICATION PENALTY alone demotes copies', () => {
  /*
   * The copies deliberately hold the BEST provider ranks. Without the penalty
   * they win outright; with it they fall. The component is asserted directly
   * too, because an order assertion could be satisfied by relevance drift.
   */
  const body = 'The council approved the new transit plan after eighteen months of public consultation.';
  const results = [
    result({ url: 'https://agg-one.com/story', title: 'Transit plan approved', snippet: body, providerRank: 0 }),
    result({ url: 'https://agg-two.com/story', title: 'Transit plan gets go-ahead', snippet: body, providerRank: 1 }),
    result({ url: 'https://agg-three.com/story', title: 'City approves transit plan', snippet: body, providerRank: 2 }),
  ];
  const ranked = rank({ query: 'council transit plan', results, freshness: 'any' });

  const penalised = ranked.filter((r) => {
    const originality = r.components.find((c) => c.name === 'originality')!;
    return originality.score < 0.5;
  });
  assert.equal(
    penalised.length,
    2,
    'the syndication penalty did not fire — every near-identical copy scored as original',
  );

  /*
   * And the one NOT penalised is the best-ranked, which is the only original
   * signal available without another fetch. Recorded plainly because it is a
   * heuristic, not a fact: if the true original is ranked third by the
   * provider, this picks the wrong one. Resolving that needs canonical-link
   * inspection at fetch time, which is a later slice.
   */
  const unpenalised = ranked.find((r) => {
    const originality = r.components.find((c) => c.name === 'originality')!;
    return originality.score >= 0.5;
  });
  assert.equal(unpenalised!.result.domain, 'agg-one.com');
});

test('🚨 a syndicated copy loses to an unrelated result it would otherwise beat', () => {
  // The integration form: the penalty must be strong enough to change an
  // actual ordering, not merely to lower a number nobody acts on.
  const body = 'The council approved the new transit plan after eighteen months of public consultation.';
  const results = [
    result({ url: 'https://origin.com/a', title: 'Transit plan approved', snippet: body, providerRank: 0 }),
    result({ url: 'https://copy.com/b', title: 'Transit plan approved', snippet: body, providerRank: 1 }),
    result({
      url: 'https://independent.com/c',
      title: 'Council transit plan analysis',
      snippet: 'An independent analysis of the council transit plan and its funding.',
      providerRank: 2,
    }),
  ];
  const ranked = rank({ query: 'council transit plan', results, freshness: 'any' }).map((r) => r.result.domain);
  assert.ok(
    ranked.indexOf('independent.com') < ranked.indexOf('copy.com'),
    `a syndicated copy outranked an independent source: ${ranked.join(' > ')}`,
  );
});

/* ------------------------------------------------------------------ *
 * 🚨 CANONICAL EVIDENCE — resolving the recorded provider-rank guess
 *
 * Originality shipped with a limitation stated plainly: provider rank was the
 * only signal, so a third-ranked original lost to a first-ranked syndication.
 * Once pages are fetched, a copy that DECLARES the original elsewhere has told
 * us something provider rank cannot.
 * ------------------------------------------------------------------ */

const BODY = 'The council approved the new transit plan after eighteen months of public consultation.';

test('🚨 a THIRD-ranked original outranks a FIRST-ranked syndication on canonical evidence', () => {
  /*
   * The exact case the recorded limitation named. Without canonical links the
   * first-ranked copy wins; with them, the copies name the original and the
   * ordering inverts.
   */
  const results = [
    result({ url: 'https://agg-one.com/story', title: 'Transit plan approved', snippet: BODY, providerRank: 0 }),
    result({ url: 'https://agg-two.com/story', title: 'Transit plan approved', snippet: BODY, providerRank: 1 }),
    result({ url: 'https://originalpaper.com/transit', title: 'Council approves transit plan', snippet: BODY, providerRank: 2 }),
  ];

  const withoutEvidence = order({ query: 'council transit plan', results, freshness: 'any' });
  assert.equal(withoutEvidence[0], 'agg-one.com', 'the fallback should favour provider rank without evidence');

  const canonicalLinks = new Map([
    ['https://agg-one.com/story', 'https://originalpaper.com/transit'],
    ['https://agg-two.com/story', 'https://originalpaper.com/transit'],
  ]);
  const withEvidence = order({ query: 'council transit plan', results, freshness: 'any', canonicalLinks });
  assert.equal(
    withEvidence[0],
    'originalpaper.com',
    `canonical evidence did not overturn provider rank: ${withEvidence.join(' > ')}`,
  );
});

test('🚨 a cross-domain canonical is NOT trusted as a claim of ownership', () => {
  /*
   * The attack. Any site can declare itself canonical for a competitor's
   * article and inherit its standing. A canonical pointing AT another domain is
   * accepted only as SELF-DEMOTION — evidence against the page that served it,
   * which nobody has an incentive to fake — and never as a claim over someone
   * else's page.
   *
   * A FORWARD GUARD, labelled honestly: no current mutation breaks it, because
   * the code never implements ownership claims in the first place. It exists to
   * fail the day someone adds "if X claims canonical over Y, boost X", which is
   * a tempting and entirely reasonable-looking change.
   */
  const results = [
    result({ url: 'https://honest.com/article', title: 'Transit plan approved', snippet: BODY, providerRank: 0 }),
    result({ url: 'https://thief.com/copy', title: 'Transit plan approved', snippet: BODY, providerRank: 1 }),
  ];
  // thief.com claims honest.com is a copy OF thief.com.
  const canonicalLinks = new Map([['https://honest.com/article', 'https://honest.com/article']]);
  const hostile = new Map([...canonicalLinks, ['https://thief.com/copy', 'https://thief.com/copy']]);

  const ranked = rank({ query: 'council transit plan', results, freshness: 'any', canonicalLinks: hostile });

  const honest = ranked.find((r) => r.result.domain === 'honest.com')!;
  const thief = ranked.find((r) => r.result.domain === 'thief.com')!;
  const honestOriginality = honest.components.find((c) => c.name === 'originality')!;
  const thiefOriginality = thief.components.find((c) => c.name === 'originality')!;

  // The victim is not demoted...
  assert.ok(
    honestOriginality.score >= 0.5,
    `a self-declared canonical demoted an unrelated page: ${honestOriginality.reason}`,
  );
  // ...and the claimant gains nothing from declaring itself.
  assert.ok(
    thiefOriginality.score < honestOriginality.score,
    `self-declaration bought standing: thief ${thiefOriginality.score} vs honest ${honestOriginality.score}`,
  );
  assert.match(
    thiefOriginality.reason,
    /provider rank/,
    'a self-declaration was treated as evidence rather than falling back',
  );
  assert.equal(ranked[0]!.result.domain, 'honest.com');
});

test('a page declaring ITSELF canonical gains nothing', () => {
  // It tells us nothing: every page can say it. Only self-demotion is evidence.
  const results = [
    result({ url: 'https://a.com/x', title: 'Transit plan', snippet: BODY, providerRank: 0 }),
    result({ url: 'https://b.com/x', title: 'Transit plan', snippet: BODY, providerRank: 1 }),
  ];
  const selfDeclared = new Map([['https://b.com/x', 'https://b.com/x']]);
  const ranked = rank({ query: 'council transit plan', results, freshness: 'any', canonicalLinks: selfDeclared });
  const b = ranked.find((r) => r.result.domain === 'b.com')!;
  const originality = b.components.find((c) => c.name === 'originality')!;
  assert.match(originality.reason, /provider rank/, 'a self-declaration was treated as evidence');
});

test('the provider-rank fallback survives when no canonical evidence exists', () => {
  // At ranking time pages may not have been fetched at all. A guess that
  // usually holds beats no ordering.
  const results = [
    result({ url: 'https://first.com/x', title: 'Transit plan', snippet: BODY, providerRank: 0 }),
    result({ url: 'https://second.com/x', title: 'Transit plan', snippet: BODY, providerRank: 1 }),
  ];
  const ranked = rank({ query: 'council transit plan', results, freshness: 'any' });
  const originality = ranked[0]!.components.find((c) => c.name === 'originality')!;
  assert.match(originality.reason, /by provider rank/, 'the fallback stopped saying it is a guess');
});

test('a malformed canonical link is ignored rather than trusted', () => {
  const results = [
    result({ url: 'https://a.com/x', title: 'Transit plan', snippet: BODY, providerRank: 0 }),
    result({ url: 'https://b.com/x', title: 'Transit plan', snippet: BODY, providerRank: 1 }),
  ];
  const broken = new Map([['https://b.com/x', 'not a url at all']]);
  const ranked = rank({ query: 'council transit plan', results, freshness: 'any', canonicalLinks: broken });
  assert.equal(ranked.length, 2, 'a malformed canonical broke ranking');
});
