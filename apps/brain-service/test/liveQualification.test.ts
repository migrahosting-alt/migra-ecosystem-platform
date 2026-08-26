/**
 * The qualification battery, and the honesty rules it exists to enforce.
 *
 * The report this produces decides which vendors sit behind the retrieval
 * capability. Its most important property is not accuracy — it is that it never
 * presents a guess as a measurement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BATTERY, CATEGORIES } from '../src/engine/live/qualification/battery.js';
import { scoreCase } from '../src/engine/live/qualification/score.js';
import { qualifyProvider, bestByCategory, type CommercialReview } from '../src/engine/live/qualification/run.js';
import { LiveSourceUnavailable, type LiveSourceProvider, type LiveSource } from '../src/engine/live/liveSourceProvider.js';

const CLEARED: CommercialReview = { status: 'cleared', costModel: 'free tier' };

const source = (over: Partial<LiveSource> = {}): LiveSource => ({
  url: 'https://example.test/a', title: 'A result', provider: 'p', rank: 0, ...over,
});

const caseById = (id: string) => BATTERY.find((c) => c.id === id)!;

function fakeProvider(
  id: string,
  handler: (query: string) => Promise<{ sources: LiveSource[]; degraded?: string }>,
): LiveSourceProvider {
  return {
    descriptor: {
      id, label: id,
      capabilities: { returnsExtractedContent: true, returnsPublishDates: true, supportsFreshnessFilter: true, commercialUseCleared: true },
      qualification: 'unqualified', costPerQueryCents: 0,
    },
    async search(q) {
      const out = await handler(q.query);
      return { provider: id, latencyMs: 1, sources: out.sources, ...(out.degraded ? { degraded: out.degraded } : {}) };
    },
  };
}

test('the battery covers distinct retrieval JOBS, not reworded questions', () => {
  // Fifteen jobs that differ in kind beat fifty that differ in wording.
  assert.ok(CATEGORIES.length >= 14, `only ${CATEGORIES.length} categories`);
  assert.equal(new Set(BATTERY.map((c) => c.id)).size, BATTERY.length, 'ids are unique');
  for (const c of BATTERY) assert.ok(c.probes.length > 20, `${c.id} does not say what it probes`);
});

test('no case asserts a specific ANSWER', () => {
  /*
   * THE DESIGN RULE. A battery that asserted "the answer is 4.2.1" would fail
   * every provider for being correct within weeks, and would quietly become a
   * test of how stale the battery is. Cases describe retrieval BEHAVIOUR only.
   */
  for (const c of BATTERY) {
    const keys = Object.keys(c);
    assert.ok(!keys.includes('expectedAnswer'), `${c.id} asserts an answer`);
    assert.ok(!keys.includes('expectedText'), `${c.id} asserts an answer`);
  }
});

test('a question with no public answer FAILS a provider that invents results', () => {
  const empty = caseById('correctly-empty');

  const restrained = scoreCase(empty, { provider: 'p', latencyMs: 5, sources: [] }, null, 5);
  assert.equal(restrained.dimensions[0]!.verdict, 'pass');

  const inventive = scoreCase(empty, { provider: 'p', latencyMs: 5, sources: [source()] }, null, 5);
  assert.equal(inventive.dimensions[0]!.verdict, 'fail');
  assert.match(inventive.dimensions[0]!.detail, /manufactured/);
});

test('an ambiguous query collapsed to one meaning is a failure', () => {
  const ambiguous = caseById('ambiguous-query');

  const collapsed = scoreCase(ambiguous, {
    provider: 'p', latencyMs: 1,
    sources: [source({ title: 'Mercury the planet' }), source({ title: 'Planet Mercury facts' })],
  }, null, 1);
  const collapsedVerdict = collapsed.dimensions.find((d) => d.dimension === 'ambiguity_preserved')!;
  assert.equal(collapsedVerdict.verdict, 'fail');
  assert.match(collapsedVerdict.detail, /chose an interpretation/);

  const preserved = scoreCase(ambiguous, {
    provider: 'p', latencyMs: 1,
    sources: [source({ title: 'Mercury the planet' }), source({ title: 'Mercury the element' })],
  }, null, 1);
  assert.equal(preserved.dimensions.find((d) => d.dimension === 'ambiguity_preserved')!.verdict, 'pass');
});

test('an empty result to the FAILURE probe is a failure, not a pass', () => {
  /*
   * The trap this case exists for: a provider that swallows a timeout and
   * returns [] is indistinguishable from one that genuinely found nothing — and
   * the router would fall past neither.
   */
  const probe = caseById('failure-behaviour');

  const swallowed = scoreCase(probe, { provider: 'p', latencyMs: 1, sources: [] }, null, 1);
  assert.equal(swallowed.dimensions[0]!.verdict, 'fail');
  assert.match(swallowed.dimensions[0]!.detail, /indistinguishable/);

  const typed = scoreCase(probe, null, { code: 'timeout', message: 'deadline' }, 1);
  assert.equal(typed.dimensions[0]!.verdict, 'pass');

  const untyped = scoreCase(probe, null, { code: 'unknown', message: 'boom' }, 1);
  assert.equal(untyped.dimensions[0]!.verdict, 'partial');
});

test('truth and support are RAISED FOR REVIEW, never scored by keyword', () => {
  /*
   * Whether retrieved material actually answers the question is a semantic
   * judgment. Scoring it by overlap would repeat a defect this codebase has
   * already paid for, so it is reported with evidence instead of guessed.
   */
  const scored = scoreCase(caseById('long-tail-fact'), {
    provider: 'p', latencyMs: 1, sources: [source({ url: 'https://man7.org/x' })],
  }, null, 1);
  const support = scored.dimensions.find((d) => d.dimension === 'answer_supported')!;
  assert.equal(support.verdict, 'needs_review');
  assert.ok(scored.evidence.sources.length > 0, 'and the raw evidence is preserved for the reader');
});

test('an untested provider is never given a score', async () => {
  /*
   * "We could not test this" and "this tested badly" must not look the same in
   * a report someone chooses a vendor from.
   */
  const noKey = await qualifyProvider(null, CLEARED, { availability: 'no_credentials' });
  assert.equal(noKey.status, 'unevaluated_no_credentials');
  assert.equal(noKey.cases, undefined);
  assert.equal(noKey.byCategory, undefined);

  const notDeployed = await qualifyProvider(
    fakeProvider('selfhosted', async () => ({ sources: [] })),
    CLEARED,
    { availability: 'not_provisioned' },
  );
  assert.equal(notDeployed.status, 'unevaluated_not_provisioned');
  assert.equal(notDeployed.cases, undefined);
});

test('ambiguous commercial terms block the run rather than being read as clearance', async () => {
  for (const status of ['unclear', 'not_reviewed'] as const) {
    const card = await qualifyProvider(
      fakeProvider('vendor', async () => ({ sources: [source()] })),
      { status },
      {},
    );
    assert.equal(card.status, 'commercial_use_unclear', status);
    assert.equal(card.cases, undefined, 'and it is not scored');
  }
});

test('forbidden commercial terms fail outright', async () => {
  const card = await qualifyProvider(
    fakeProvider('vendor', async () => ({ sources: [source()] })),
    { status: 'forbidden' },
    {},
  );
  assert.equal(card.status, 'failed');
  assert.match(card.note!, /forbidden/);
});

test('the report ranks per category, and never invents a global winner', async () => {
  /*
   * The point of the whole exercise: these services are good at different jobs,
   * and one ranking would throw away what the router needs.
   */
  const finder = fakeProvider('finds-official', async () => ({
    sources: [source({ url: 'https://www.gov.uk/set-up-limited-company', publishedAt: '2026-01-01' })],
  }));
  const restrained = fakeProvider('restrained', async () => ({ sources: [] }));

  const [a, b] = await Promise.all([
    qualifyProvider(finder, CLEARED, { only: ['official_source', 'correctly_empty'] }),
    qualifyProvider(restrained, CLEARED, { only: ['official_source', 'correctly_empty'] }),
  ]);

  const table = bestByCategory([a, b]);
  assert.equal(table.official_source![0]!.providerId, 'finds-official', 'one wins the authority job');
  assert.equal(table.correctly_empty![0]!.providerId, 'restrained', 'the OTHER wins restraint');
});

test('a provider that was never run is absent from the leaderboard, not last', async () => {
  const tested = await qualifyProvider(
    fakeProvider('tested', async () => ({ sources: [source({ url: 'https://www.gov.uk/x' })] })),
    CLEARED,
    { only: ['official_source'] },
  );
  const untested = await qualifyProvider(null, CLEARED, { availability: 'no_credentials' });

  const table = bestByCategory([tested, untested]);
  assert.deepEqual(table.official_source!.map((r) => r.providerId), ['tested']);
});

test('a provider that fails every job is not qualified', async () => {
  const useless = fakeProvider('useless', async () => {
    throw new LiveSourceUnavailable('useless', 'transport', 'nope');
  });
  const card = await qualifyProvider(useless, CLEARED, { only: ['official_source', 'long_tail_fact'] });
  assert.equal(card.status, 'failed');
});
