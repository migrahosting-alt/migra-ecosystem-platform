/**
 * EXTRACTION — turning a fetched page into evidence, and refusing to invent
 * the parts that are missing.
 *
 * The failures worth guarding here all look like helpfulness: no date so use
 * today's, no title so use the slug, no language so guess from the words. Each
 * one makes a downstream ranker or citation MORE confident on LESS, which is
 * the precise shape of every grounding defect in this repository's history.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractDocument } from '../src/engine/search/extract.js';

const AT = '2026-09-08T12:00:00.000Z';
const run = (html: string, url = 'https://example.com/article') =>
  extractDocument({ url, html, retrievedAt: AT });

/* ------------------------------------------------------------------ *
 * Fixture: an ordinary article
 * ------------------------------------------------------------------ */

const ARTICLE = `<!doctype html><html lang="en"><head>
<title>Transit plan approved</title>
<meta property="article:published_time" content="2026-03-04T09:30:00Z">
<meta property="article:modified_time" content="2026-03-05T11:00:00Z">
</head><body>
<nav><a href="/">Home</a><a href="/news">News</a></nav>
<header>Daily Example</header>
<article>
  <h1>Transit plan approved</h1>
  <p>The council approved the plan after eighteen months of consultation.</p>
  <h2>What happens next</h2>
  <p>Construction begins in the spring, subject to funding.</p>
  <ul><li>Phase one: downtown</li><li>Phase two: the east side</li></ul>
</article>
<footer>Copyright Daily Example</footer>
<script>window.tracking = true;</script>
</body></html>`;

test('an article yields title, body, headings and lists', () => {
  const doc = run(ARTICLE);
  assert.equal(doc.title, 'Transit plan approved');
  assert.match(doc.text, /eighteen months of consultation/);
  assert.deepEqual(doc.headings, ['Transit plan approved', 'What happens next']);
  assert.deepEqual(doc.lists, [['Phase one: downtown', 'Phase two: the east side']]);
  assert.equal(doc.language, 'en');
  assert.equal(doc.publishedAt, '2026-03-04T09:30:00.000Z');
  assert.equal(doc.modifiedAt, '2026-03-05T11:00:00.000Z');
});

test('scripts, styles and page furniture are not body text', () => {
  const doc = run(ARTICLE);
  assert.ok(!doc.text.includes('window.tracking'), 'script contents leaked into the body');
  assert.ok(!doc.text.includes('Copyright Daily Example'), 'footer leaked into the body');
  assert.ok(!doc.text.includes('Home'), 'navigation leaked into the body');
});

test('the content hash covers the extracted text', () => {
  // A citation must be able to prove the thing it cited is the thing we read.
  const a = run(ARTICLE);
  const b = run(ARTICLE);
  assert.equal(a.contentHash, b.contentHash, 'extraction is not deterministic');
  const changed = run(ARTICLE.replace('eighteen', 'nineteen'));
  assert.notEqual(a.contentHash, changed.contentHash, 'the hash did not track the text');
});

/* ------------------------------------------------------------------ *
 * 🚨 Fabrication
 * ------------------------------------------------------------------ */

test('🚨 a page with NO date gets no date — not today', () => {
  /*
   * The single most damaging default available here. Filling in `now` makes a
   * decade-old page rank as current for a "latest" query, and the ranker has
   * no way to tell it was invented.
   */
  const doc = run('<html><body><article><p>Some text with enough length to be a body of content here.</p></article></body></html>');
  assert.equal(doc.publishedAt, undefined);
  assert.ok(doc.warnings.some((w) => /publication date/.test(w)), 'the missing date was not recorded');
  assert.notEqual(doc.retrievedAt, doc.publishedAt);
});

test('🚨 misleading metadata is not promoted to a publication date', () => {
  /*
   * `<meta>` is an open namespace. `expires`, `revised`, and CMS-specific
   * fields are date-shaped and are NOT publication dates. An allowlist is the
   * only safe reading.
   */
  const doc = run(`<html><head>
    <meta name="expires" content="2030-01-01T00:00:00Z">
    <meta name="revised" content="2001-01-01T00:00:00Z">
    <meta name="random-cms-date" content="1999-05-05T00:00:00Z">
  </head><body><article><p>Body text long enough to count as an article body here.</p></article></body></html>`);
  assert.equal(doc.publishedAt, undefined, 'an unmapped meta field was treated as a publication date');
});

test('🚨 a page with no title gets no title — not the URL slug', () => {
  const doc = run('<html><body><article><p>Text that is long enough to be treated as the body.</p></article></body></html>',
    'https://example.com/how-to-tie-a-knot');
  assert.equal(doc.title, undefined);
  assert.ok(!JSON.stringify(doc).includes('how-to-tie-a-knot') || doc.canonicalUrl.includes('how-to-tie-a-knot'));
  assert.ok(doc.warnings.includes('no title'));
});

test('🚨 language is taken from the declaration, never guessed', () => {
  const doc = run('<html><body><article><p>Ceci est un texte en francais avec assez de mots pour compter.</p></article></body></html>');
  assert.equal(doc.language, undefined, 'the language was inferred from the words');
  assert.ok(doc.warnings.some((w) => /language/.test(w)));
});

/* ------------------------------------------------------------------ *
 * Empty and malformed
 * ------------------------------------------------------------------ */

test('🚨 an empty body is a SUCCESS with a warning, not a failure', () => {
  /*
   * "Retrieved and had nothing extractable" — a JS-rendered app, a paywall —
   * is not "could not be retrieved". Conflating them sends the caller looking
   * for a network problem that does not exist.
   */
  const doc = run('<html><body><div id="root"></div></body></html>');
  assert.equal(doc.text, '');
  assert.ok(doc.warnings.some((w) => /no readable body/.test(w)));
  assert.equal(typeof doc.contentHash, 'string', 'an empty document still has an identity');
});

test('malformed HTML degrades rather than throwing', () => {
  const messy = '<html><body><article><p>Unclosed paragraph <div>nested oddly <span>text here that is long enough</article>';
  const doc = run(messy);
  assert.equal(typeof doc.text, 'string');
  assert.ok(doc.text.length > 0, 'nothing was recovered from recoverable markup');
});

test('an unclosed script does not swallow the document', () => {
  // A greedy strip would eat everything after an unclosed tag and report an
  // empty page — silently losing content that is right there.
  const doc = run('<html><body><script>var x = 1;<article><p>Real content that should survive extraction.</p></article></body></html>');
  assert.match(doc.text, /Real content that should survive/);
});

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

test('a table with a header row keeps its headers', () => {
  const doc = run(`<html><body><article>
    <table>
      <tr><th>Region</th><th>Revenue</th></tr>
      <tr><td>North</td><td>120000</td></tr>
      <tr><td>South</td><td>95000</td></tr>
    </table>
    <p>Padding text to make this look like an article body worth extracting.</p>
  </article></body></html>`);
  assert.equal(doc.tables.length, 1);
  assert.deepEqual(doc.tables[0]!.headers, ['Region', 'Revenue']);
  assert.deepEqual(doc.tables[0]!.rows, [['North', '120000'], ['South', '95000']]);
});

test('🚨 a table with NO header row does not get one invented', () => {
  // Promoting the first data row to a header would relabel real data as
  // column names — a fabrication that silently changes what the table says.
  const doc = run(`<html><body><article>
    <table><tr><td>North</td><td>120000</td></tr><tr><td>South</td><td>95000</td></tr></table>
    <p>Padding text to make this look like an article body worth extracting.</p>
  </article></body></html>`);
  assert.deepEqual(doc.tables[0]!.headers, []);
  assert.equal(doc.tables[0]!.rows.length, 2, 'a data row was consumed as a header');
});

test('a navigation-heavy page still finds its article', () => {
  const doc = run(`<html><body>
    <nav>${Array.from({ length: 40 }, (_, i) => `<a href="/${i}">Link ${i}</a>`).join('')}</nav>
    <article><p>The actual content of this page is short but it is the real content.</p></article>
    <aside>Related stories and advertisements go here in large quantity.</aside>
  </body></html>`);
  assert.match(doc.text, /the real content/);
  assert.ok(!doc.text.includes('Link 39'), 'navigation dominated the extraction');
});

test('a docs page without <article> falls back and says so', () => {
  const doc = run(`<html><body>
    <nav>sidebar links</nav>
    <div class="content"><h1>API reference</h1><p>${'Documentation body text. '.repeat(20)}</p></div>
  </body></html>`);
  assert.match(doc.text, /Documentation body text/);
  assert.ok(
    doc.warnings.some((w) => /no article or main element/.test(w)),
    'the fallback was silent — the caller cannot tell how the body was chosen',
  );
});

test('entities are decoded so the text reads as the page reads', () => {
  const doc = run('<html><body><article><p>Ben &amp; Jerry&#39;s &quot;flavour&quot; &nbsp;list here with padding text.</p></article></body></html>');
  assert.match(doc.text, /Ben & Jerry's "flavour"/);
});

test('the canonical URL is used, not the raw one', () => {
  const doc = run(ARTICLE, 'https://www.example.com/article?utm_source=x');
  assert.ok(!doc.canonicalUrl.includes('utm_source'));
  assert.equal(doc.domain, 'example.com');
});
