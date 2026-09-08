/**
 * TURNING A FETCHED PAGE INTO EVIDENCE.
 *
 * ---------------------------------------------------------------------------
 * A SNIPPET IS NOT EVIDENCE
 *
 * The provider's snippet is a fragment chosen by someone else to make a result
 * look relevant. Answering from snippets means answering from advertising copy.
 * Evidence is the page's own text, retrieved by us, hashed so a later reader
 * can tell whether the thing we cited is the thing we read.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE RULE THAT SHAPES EVERY DECISION BELOW: DO NOT FABRICATE
 *
 * The tempting failures here all look like helpfulness:
 *
 *   · no date on the page, so use today's           → a fabricated fact
 *   · no <title>, so use the URL slug               → a guess wearing a title
 *   · no <html lang>, so guess from the words       → confident and often wrong
 *   · empty body, so report a fetch failure         → the wrong failure entirely
 *
 * Every one of these makes a downstream ranker or citation more confident on
 * less. Absent stays absent, and `warnings` records what was missing so the
 * caller can decide rather than being quietly handed a default.
 *
 * ---------------------------------------------------------------------------
 * WHY A HAND-ROLLED PARSER
 *
 * A DOM library would be better at malformed markup. It is also a dependency
 * that runs attacker-controlled input in the Brain's process. This walks text
 * with regular expressions, never executes anything, cannot be tricked into
 * loading a subresource, and degrades to "no body found" rather than throwing.
 * The tradeoff is accepted deliberately: worse extraction, smaller attack
 * surface, and `warnings` tells the truth when it did badly.
 */

import { createHash } from 'node:crypto';

import { canonicalizeUrl, domainOf } from './normalize.js';

export interface ExtractedTable {
  /** Header cells, when the table has a header row. */
  headers: string[];
  rows: string[][];
}

export interface ExtractedDocument {
  canonicalUrl: string;
  domain: string;
  /** The page's own title. Absent when it has none — never the URL slug. */
  title?: string;
  /** Main body text, boilerplate removed. Empty is a legitimate outcome. */
  text: string;
  headings: string[];
  lists: string[][];
  tables: ExtractedTable[];
  /** Only from an explicit `lang` attribute. Never inferred from the words. */
  language?: string;
  /** Only from a mapped, explicit metadata field. Never "now". */
  publishedAt?: string;
  modifiedAt?: string;
  /** When WE read it. Always known, and never a substitute for publishedAt. */
  retrievedAt: string;
  /** sha256 of the extracted text — lets a citation prove what it cited. */
  contentHash: string;
  /** What was missing or suspicious. The honest half of the result. */
  warnings: string[];
}

/**
 * Metadata fields we accept as a publication date, and nothing else.
 *
 * An explicit allowlist because `<meta>` is an open namespace: a page may
 * carry `date`, `dc.date`, `revised`, `expires`, `og:updated_time` and a
 * dozen CMS-specific fields, several of which are not publication dates at
 * all. Treating any date-shaped meta tag as authoritative is how a 2019
 * article gets ranked as today's news.
 */
const PUBLISHED_META = [
  'article:published_time',
  'og:published_time',
  'datepublished',
  'dc.date.issued',
  'parsely-pub-date',
];

const MODIFIED_META = ['article:modified_time', 'og:updated_time', 'datemodified', 'dc.date.modified'];

/** Elements whose contents are never page content. */
const STRIP_ELEMENTS = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed'];

/** Elements that are page furniture rather than the article. */
const BOILERPLATE_ELEMENTS = ['nav', 'header', 'footer', 'aside', 'form'];

const decodeEntities = (text: string): string =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));

const textOf = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Remove an element and everything inside it. */
function stripElement(html: string, tag: string): string {
  // Non-greedy, case-insensitive, and tolerant of attributes. An unclosed tag
  // is left alone rather than swallowing the rest of the document.
  return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
}

/**
 * The element most likely to hold the article.
 *
 * Preference order is structural, not heuristic scoring: `<article>` and
 * `<main>` are declarations by the author about where the content is, and
 * honouring them beats guessing by text density. Only when neither exists does
 * this fall back to `<body>` with furniture removed.
 */
function mainRegion(html: string): { region: string; usedFallback: boolean } {
  for (const tag of ['article', 'main']) {
    const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (match?.[1] && textOf(match[1]).length > 200) {
      return { region: match[1], usedFallback: false };
    }
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  let region = body?.[1] ?? html;
  for (const tag of BOILERPLATE_ELEMENTS) region = stripElement(region, tag);
  return { region, usedFallback: true };
}

function metaContent(html: string, names: string[]): string | undefined {
  for (const name of names) {
    // Either attribute order; `property` and `name` are both used in the wild.
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const value = html.match(pattern)?.[1];
      if (value) return decodeEntities(value.trim());
    }
  }
  return undefined;
}

/** An ISO-8601-ish date, or nothing. A value we cannot parse is not a date. */
function asDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

export function extractDocument(input: {
  url: string;
  html: string;
  retrievedAt: string;
}): ExtractedDocument {
  const warnings: string[] = [];
  const canonicalUrl = canonicalizeUrl(input.url);

  let html = input.html;
  for (const tag of STRIP_ELEMENTS) html = stripElement(html, tag);
  // Comments can hold anything, including markup that would confuse the walk.
  html = html.replace(/<!--[\s\S]*?-->/g, ' ');

  // ── title ────────────────────────────────────────────────────────────────
  const rawTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const ogTitle = metaContent(html, ['og:title']);
  const title = textOf(rawTitle ?? '') || ogTitle;
  if (!title) warnings.push('no title');

  // ── dates: explicit fields only ──────────────────────────────────────────
  const publishedAt = asDate(metaContent(html, PUBLISHED_META));
  const modifiedAt = asDate(metaContent(html, MODIFIED_META));
  if (!publishedAt) {
    /*
     * Recorded rather than filled in. A ranker that wants freshness must be
     * able to see that the date is UNKNOWN, not receive today's date and treat
     * a decade-old page as current.
     */
    warnings.push('no publication date');
  }

  // ── language: declared only ──────────────────────────────────────────────
  const language = html.match(/<html\b[^>]*\blang=["']([a-zA-Z-]+)["']/i)?.[1]?.toLowerCase();
  if (!language) warnings.push('no declared language');

  // ── body ─────────────────────────────────────────────────────────────────
  const { region, usedFallback } = mainRegion(html);
  if (usedFallback) warnings.push('no article or main element — used body with boilerplate removed');

  const headings = [...region.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .map((m) => textOf(m[1] ?? ''))
    .filter((h) => h.length > 0);

  const lists = [...region.matchAll(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => [...(m[2] ?? '').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => textOf(li[1] ?? '')))
    .map((items) => items.filter((i) => i.length > 0))
    .filter((items) => items.length > 0);

  const tables: ExtractedTable[] = [];
  for (const match of region.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const inner = match[1] ?? '';
    const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
      [...(tr[1] ?? '').matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) => textOf(cell[2] ?? '')),
    );
    if (rows.length === 0) continue;
    // A header row is one made of <th>. Absent that, all rows are data —
    // promoting the first row would invent a header the page never declared.
    const firstIsHeader = /<th\b/i.test(inner.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i)?.[0] ?? '');
    tables.push(
      firstIsHeader
        ? { headers: rows[0] ?? [], rows: rows.slice(1) }
        : { headers: [], rows },
    );
  }

  const text = textOf(region);
  if (text.length === 0) {
    /*
     * 🚨 EMPTY IS NOT A FETCH FAILURE. The page was retrieved successfully and
     * had nothing extractable — a JavaScript-rendered app, a paywall, an image.
     * Reporting this as a failure would send the caller looking for a network
     * problem that does not exist.
     */
    warnings.push('no readable body — the page may render its content in the browser');
  }

  return {
    canonicalUrl,
    domain: domainOf(canonicalUrl),
    ...(title ? { title } : {}),
    text,
    headings,
    lists,
    tables,
    ...(language ? { language } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(modifiedAt ? { modifiedAt } : {}),
    retrievedAt: input.retrievedAt,
    contentHash: createHash('sha256').update(text).digest('hex'),
    warnings,
  };
}
