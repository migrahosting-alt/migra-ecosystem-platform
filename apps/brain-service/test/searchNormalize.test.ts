/**
 * Canonicalisation and dedup — the layer that stops one article looking like
 * five independent sources.
 *
 * The failure this guards is not a tidy result list. It is MANUFACTURED
 * CORROBORATION: a model reading the same syndicated story five times and
 * answering with five citations that are one source. A thin answer is honest;
 * a falsely corroborated one is not.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeUrl,
  deduplicate,
  domainOf,
  identityOf,
  nearlyIdentical,
  resolveMirror,
} from '../src/engine/search/normalize.js';

/* ------------------------------------------------------------------ *
 * Canonicalisation
 * ------------------------------------------------------------------ */

test('tracking parameters are stripped, real query parameters are not', () => {
  const canonical = canonicalizeUrl('https://example.com/a?id=7&utm_source=x&gclid=y&page=2');
  assert.ok(canonical.includes('id=7'), 'a meaningful parameter was dropped');
  assert.ok(canonical.includes('page=2'), 'a meaningful parameter was dropped');
  assert.ok(!canonical.includes('utm_source'));
  assert.ok(!canonical.includes('gclid'));
});

test('the same document written five ways has ONE identity', () => {
  const forms = [
    'https://example.com/article',
    'https://www.example.com/article',
    'http://example.com/article',
    'https://example.com/article/',
    'https://example.com/article?utm_campaign=spring',
  ];
  const identities = new Set(forms.map(canonicalizeUrl));
  assert.equal(identities.size, 1, `expected one identity, got: ${[...identities].join(', ')}`);
});

test('query parameter ORDER does not create a second identity', () => {
  assert.equal(canonicalizeUrl('https://e.com/a?b=1&a=2'), canonicalizeUrl('https://e.com/a?a=2&b=1'));
});

test('a fragment is dropped, but a #! route is NOT', () => {
  // #foo addresses a place inside one document; #!/foo can be the only thing
  // distinguishing two documents, and merging those loses a real result.
  assert.equal(canonicalizeUrl('https://e.com/a#section'), canonicalizeUrl('https://e.com/a'));
  assert.notEqual(canonicalizeUrl('https://e.com/a#!/x'), canonicalizeUrl('https://e.com/a#!/y'));
});

test('an unparseable URL survives unchanged rather than being dropped', () => {
  // It is still a result the provider returned. Losing it to tidy the dedup
  // table trades a real source for a cleaner internal structure.
  assert.equal(canonicalizeUrl('not a url'), 'not a url');
});

test('case in host is normalised; case in path is preserved', () => {
  const canonical = canonicalizeUrl('https://EXAMPLE.com/Path/To/Doc');
  assert.ok(canonical.includes('example.com'));
  assert.ok(canonical.includes('/Path/To/Doc'), 'path case was destroyed — paths are case-sensitive');
});

/* ------------------------------------------------------------------ *
 * Domain
 * ------------------------------------------------------------------ */

test('domains do not over-collapse on multi-part suffixes', () => {
  /*
   * Without a public-suffix list, naive "last two labels" would reduce
   * example.co.uk to co.uk and make every UK publisher look like one source —
   * destroying source diversity precisely where it matters.
   */
  assert.equal(domainOf('https://www.example.co.uk/a'), 'example.co.uk');
  assert.notEqual(domainOf('https://a.co.uk/x'), domainOf('https://b.co.uk/x'));
});

/* ------------------------------------------------------------------ *
 * Mirrors
 * ------------------------------------------------------------------ */

test('AMP mirrors resolve back to the publisher', () => {
  assert.equal(
    identityOf('https://www-example-com.cdn.ampproject.org/c/s/www.example.com/story'),
    identityOf('https://example.com/story'),
  );
  assert.equal(identityOf('https://example.com/story/amp'), identityOf('https://example.com/story'));
});

test('a non-mirror URL is returned untouched', () => {
  assert.equal(resolveMirror('https://example.com/a'), 'https://example.com/a');
});

/* ------------------------------------------------------------------ *
 * Dedup
 * ------------------------------------------------------------------ */

const r = (url: string, providerRank: number, title = 't', snippet = 's') => ({
  url,
  title,
  snippet,
  providerRank,
});

test('🚨 five copies of one story collapse to one', () => {
  const survivors = deduplicate([
    r('https://example.com/story', 3),
    r('https://www.example.com/story', 5),
    r('https://example.com/story?utm_source=x', 7),
    r('https://example.com/story/', 9),
    r('https://www-example-com.cdn.ampproject.org/c/s/example.com/story', 11),
  ]);
  assert.equal(survivors.length, 1, 'duplicates survived — the answer would cite one source five times');
  assert.equal(survivors[0]!.providerRank, 3, 'the best-ranked copy was not the survivor');
});

test('genuinely different sources are NOT merged', () => {
  // Two outlets covering one event are two sources. Merging them would hide
  // real agreement, which is a worse error than showing both.
  const survivors = deduplicate([r('https://a.com/story', 1), r('https://b.com/story', 2)]);
  assert.equal(survivors.length, 2);
});

test('dedup REMOVES but never reorders — even when rank and position disagree', () => {
  /*
   * 🚨 THIS TEST FOUND A REAL BUG.
   *
   * A first implementation kept the best-ranked member and filtered the
   * original array. Where rank and position disagree, that moved a group to
   * its later member's position — a reorder from a stage whose whole contract
   * is that it only removes. Real providers return in rank order, so it would
   * have stayed hidden until one did not.
   *
   * The two properties are asserted separately because they are separate:
   * the group keeps its EARLIEST position, and the BEST-RANKED member is what
   * survives.
   */
  const survivors = deduplicate([
    r('https://a.com/1', 9),          // group A, first at index 0, worse rank
    r('https://b.com/2', 1),          // group B
    r('https://a.com/1?utm_source=x', 4), // group A again, better rank
  ]);

  assert.equal(survivors.length, 2);
  assert.deepEqual(
    survivors.map((s) => domainOf(s.url)),
    ['a.com', 'b.com'],
    'group A lost its position — dedup reordered instead of only removing',
  );
  assert.equal(survivors[0]!.providerRank, 4, 'the worse-ranked member of group A survived');
});

test('ranking is a separate stage — dedup never sorts by rank', () => {
  // If dedup sorted, a surprising final order could not be attributed to
  // either stage with confidence.
  const survivors = deduplicate([r('https://z.com/1', 9), r('https://a.com/2', 1)]);
  assert.deepEqual(survivors.map((s) => domainOf(s.url)), ['z.com', 'a.com']);
});

/* ------------------------------------------------------------------ *
 * Near-identical text
 * ------------------------------------------------------------------ */

test('syndicated copy with a reworded headline is detectable', () => {
  const body = 'The council approved the new transit plan after a lengthy public consultation process';
  assert.equal(nearlyIdentical(body, body), true);
});

test('a summary is NOT called a duplicate of the article it summarises', () => {
  /*
   * Containment would say yes here. Jaccard says no, deliberately: a false
   * merge DELETES a source, which is the more expensive mistake.
   */
  const article =
    'The council approved the new transit plan after a lengthy public consultation process ' +
    'that ran for eighteen months and involved seven separate neighbourhood meetings';
  const summary = 'The council approved the transit plan';
  assert.equal(nearlyIdentical(article, summary), false);
});

test('unrelated text is not near-identical', () => {
  assert.equal(nearlyIdentical('quarterly revenue rose sharply', 'volcanic activity increased overnight'), false);
});

test('empty text never counts as a duplicate', () => {
  assert.equal(nearlyIdentical('', ''), false);
  assert.equal(nearlyIdentical('something real here', ''), false);
});
