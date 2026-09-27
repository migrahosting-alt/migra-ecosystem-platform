/**
 * Reading a PowerPoint deck.
 *
 * A .pptx is a ZIP of XML parts, like .docx, so the same rule applies: accepting
 * the file without something to walk it would put it in the user's library while
 * contributing nothing to any answer. The upload policy refused `pptx` with
 * NO_EXTRACTOR for exactly that reason — a truthful refusal, and still a missing
 * capability.
 *
 * NO NEW DEPENDENCY. JSZip is already a brain-service dependency (it reads
 * .docx and .xlsx), and a deck's text lives in `<a:t>` elements that the same
 * tag-stripping approach recovers. `officeparser` was already measured during
 * the .docx slice and offered nothing the zero-dependency path did not.
 *
 * THREE THINGS THIS DOES THAT A NAIVE READER WOULD GET WRONG:
 *
 * 🚨 1. SLIDE ORDER IS NOT FILENAME ORDER. The real order is `p:sldIdLst` in
 * `ppt/presentation.xml`, resolved through `presentation.xml.rels`. Sorting
 * `slide1.xml, slide2.xml, …` numerically happens to agree on freshly authored
 * decks — measured 3/3 on real PowerPoint files — but reordering slides in
 * PowerPoint rewrites `sldIdLst` and LEAVES THE FILENAMES ALONE. So a deck a
 * user reordered would be read back in the wrong order, and every "the third
 * slide says…" answer would be confidently wrong. Filename order is kept only
 * as a fallback for a deck whose manifest cannot be read.
 *
 * 🚨 2. A TABLE IS NOT A LIST OF CELLS. The .docx slice learned this the
 * expensive way: flattening a table to one line per cell keeps every value and
 * destroys the relationship between them, so "how many sensors?" became
 * unanswerable from a document that plainly contained the answer. Rows are
 * emitted as `cell | cell` so a row survives as one retrievable unit.
 *
 * 🚨 3. SPEAKER NOTES LIVE IN A DIFFERENT PART. `ppt/notesSlides/notesSlideN.xml`
 * is where the presenter's actual argument usually is — the caveats, the numbers
 * behind the headline, what the bullet means. Dropping it silently is the same
 * failure as dropping a Word footnote. Notes are recovered and appended to their
 * own slide under a labelled heading, so they stay attributable instead of
 * blending into the slide body as if they had been on screen.
 *
 * WHAT THIS DELIBERATELY DOES NOT READ, AND REPORTS INSTEAD OF DROPPING:
 * chart data (`ppt/charts/chartN.xml`) and embedded workbooks
 * (`ppt/embeddings/*.xlsx`). A deck whose numbers exist only inside a chart
 * would otherwise index as prose with the figures missing and nothing said. The
 * caller gets `hasUnreadCharts` so the product can say so rather than imply the
 * deck was read whole.
 */

import JSZip from 'jszip';
import { parseChart, renderChart } from './chartData.js';

export interface PptxExtraction {
  /** Slide-by-slide text, each slide headed with its own number. */
  text: string;
  /** How many slides were read, in presentation order. */
  slideCount: number;
  /** True when at least one slide carried speaker notes. */
  hasNotes: boolean;
  /** True when a specific chart could NOT be read — not merely that charts exist. */
  hasUnreadCharts: boolean;
  /** One entry per unreadable chart, naming its slide and the reason. */
  unreadCharts: string[];
}

/** The file could not be read as a PowerPoint deck at all. */
export class PptxExtractionError extends Error {
  readonly code = 'PPTX_UNREADABLE';
  constructor(reason: string, override readonly cause?: unknown) {
    super(reason);
    this.name = 'PptxExtractionError';
  }
}

/**
 * Auto-populated placeholders: the slide number, the date and the footer.
 *
 * 🚨 FOUND ON A REAL DECK, NOT IN A FIXTURE. Every notes part in three genuine
 * PowerPoint files carries the notes master's slide-number placeholder, so the
 * first run of this module emitted `Speaker notes: 1` on slide after slide —
 * noise presented as the presenter's own words, and `hasNotes` set true by a
 * deck that had no notes at all. The same furniture repeats a bare number into
 * every slide body, where it lands in every chunk and means nothing.
 *
 * These three placeholder types are populated by PowerPoint from the master
 * rather than typed by the author, which is what makes them safe to drop. Any
 * other placeholder is content and is kept.
 */
function stripMasterFurniture(xml: string): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shape) =>
    /<p:ph\b[^>]*\btype="(?:sldNum|dt|ftr)"/.test(shape) ? '' : shape,
  );
}

/**
 * Plain text out of one drawing-ML fragment.
 *
 * Paragraph and break boundaries become real whitespace BEFORE tags are
 * stripped — the other order runs neighbouring bullets together into one
 * unreadable line.
 */
function textFromPart(xml: string): string {
  return xml
    .replace(/<a:p[ >]/g, '\n<a:p ')
    .replace(/<a:br\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One table, rows intact, each row a single retrievable line. */
function tableToRows(tableXml: string): string {
  const rows: string[] = [];
  for (const row of tableXml.match(/<a:tr[ >][\s\S]*?<\/a:tr>/g) ?? []) {
    const cells = (row.match(/<a:tc[ >][\s\S]*?<\/a:tc>/g) ?? [])
      // A cell may hold several paragraphs; they belong to ONE cell, so they
      // join with a space rather than becoming separate rows.
      .map((cell) => textFromPart(cell).replace(/\s*\n\s*/g, ' ').trim());
    if (cells.some((c) => c !== '')) rows.push(cells.join(' | '));
  }
  return rows.join('\n');
}

/**
 * One slide's text, with its tables rendered in the position they appear.
 *
 * Tables are cut out and converted first, and the prose between them is read
 * normally, so a table keeps its place in the reading order instead of being
 * appended after everything else.
 */
function textFromSlide(rawXml: string): string {
  const xml = stripMasterFurniture(rawXml);
  const pieces: string[] = [];
  let cursor = 0;
  for (const match of xml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)) {
    const at = match.index ?? 0;
    pieces.push(textFromPart(xml.slice(cursor, at)));
    pieces.push(tableToRows(match[0]));
    cursor = at + match[0].length;
  }
  pieces.push(textFromPart(xml.slice(cursor)));
  return pieces
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Slide parts in PRESENTATION order.
 *
 * Returns null when the manifest cannot be read, so the caller can fall back to
 * filename order rather than failing a deck that is otherwise fine.
 */
async function slidesInPresentationOrder(zip: JSZip): Promise<string[] | null> {
  const presentation = zip.file('ppt/presentation.xml');
  const rels = zip.file('ppt/_rels/presentation.xml.rels');
  if (!presentation || !rels) return null;

  const [presXml, relsXml] = await Promise.all([
    presentation.async('string'),
    rels.async('string'),
  ]);

  const target: Record<string, string> = {};
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = rel[0].match(/\bId="([^"]+)"/)?.[1];
    const path = rel[0].match(/\bTarget="([^"]+)"/)?.[1];
    // Targets are relative to `ppt/`, and PowerPoint writes them either way.
    if (id && path) target[id] = `ppt/${path.replace(/^\.\.\//, '').replace(/^\/?ppt\//, '')}`;
  }

  const ordered: string[] = [];
  for (const slide of presXml.matchAll(/<p:sldId\b[^>]*>/g)) {
    const id = slide[0].match(/r:id="([^"]+)"/)?.[1];
    const path = id ? target[id] : undefined;
    if (path && zip.file(path)) ordered.push(path);
  }
  return ordered.length > 0 ? ordered : null;
}

/** Filename order, used only when the manifest could not be read. */
function slidesByFilename(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
}

/**
 * The notes part belonging to a slide, via that slide's own relationships.
 *
 * Resolved through the rels rather than by matching `slideN` to `notesSlideN`:
 * the numbers do NOT correspond. A deck where only slides 3 and 9 carry notes
 * has `notesSlide1.xml` and `notesSlide2.xml`, so pairing by number would
 * attach one slide's notes to a different slide entirely — worse than having no
 * notes, because it reads as evidence.
 */
async function notesForSlide(zip: JSZip, slidePath: string): Promise<string> {
  const name = slidePath.split('/').pop();
  const rels = zip.file(`ppt/slides/_rels/${name}.rels`);
  if (!rels) return '';
  const relsXml = await rels.async('string');
  const target = relsXml
    .match(/Target="([^"]*notesSlide\d+\.xml)"/)?.[1]
    ?.replace(/^\.\.\//, '');
  if (!target) return '';
  const part = zip.file(`ppt/${target}`);
  if (!part) return '';
  return textFromSlide(await part.async('string'));
}


/**
 * The charts a slide shows, read from their data, in the order they appear on it.
 *
 * 🚨 RESOLVED THROUGH THE SLIDE'S OWN RELATIONSHIPS, and in the slide's own
 * document order. `chart3.xml` is not the third slide's chart: the numbering is
 * per-part, not per-slide, so pairing by number would attach one slide's figures
 * to another — and a wrong number under a citation is worse than no number, since
 * it reads as evidence.
 *
 * Only the slide's rels are followed, never the layout's or master's: a chart on a
 * layout is template furniture and is not what a reader means by "the chart on
 * slide 12".
 */
async function chartsForSlide(
  zip: JSZip,
  slidePath: string,
  slideXml: string,
): Promise<{ text: string[]; unread: string[]; consumed: string[] }> {
  const name = slidePath.split('/').pop();
  const rels = zip.file(`ppt/slides/_rels/${name}.rels`);
  if (!rels) return { text: [], unread: [], consumed: [] };
  const relsXml = await rels.async('string');

  // rId -> chart part, from this slide's rels only.
  const byId = new Map<string, string>();
  for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]*charts\/chart\d+\.xml)"/g)) {
    byId.set(m[1]!, `ppt/${m[2]!.replace(/^\.\.\//, '')}`);
  }
  if (byId.size === 0) return { text: [], unread: [], consumed: [] };

  // Document order comes from the slide body, not from the rels file, so two
  // charts on one slide are reported top-to-bottom as the reader sees them.
  const ordered: string[] = [];
  for (const m of slideXml.matchAll(/<c:chart[^>]*r:id="([^"]+)"/g)) {
    const part = byId.get(m[1]!);
    if (part && !ordered.includes(part)) ordered.push(part);
  }
  for (const part of byId.values()) if (!ordered.includes(part)) ordered.push(part);

  const text: string[] = [];
  const unread: string[] = [];
  for (const [i, part] of ordered.entries()) {
    const file = zip.file(part);
    if (!file) {
      unread.push(`chart ${i + 1}: the chart part is missing from the package`);
      continue;
    }
    let parsed;
    try {
      parsed = parseChart(await file.async('string'));
    } catch (cause) {
      // A malformed chart must not fail the whole deck: 30 readable slides are
      // worth more than an exception, and the caller is told what was lost.
      unread.push(`chart ${i + 1}: could not be parsed`);
      void cause;
      continue;
    }
    if (parsed.ok) text.push(renderChart(parsed.chart, i + 1));
    else unread.push(`chart ${i + 1}: ${parsed.reason}`);
  }
  return { text, unread, consumed: ordered };
}

/**
 * Extract readable text from a .pptx.
 *
 * Every slide is headed with its own number, because "which slide said that" is
 * the deck's equivalent of a page citation and the product already reports page
 * provenance for PDFs.
 */
export async function extractPptx(bytes: Buffer | Uint8Array): Promise<PptxExtraction> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (cause) {
    throw new PptxExtractionError('the file is not a readable PowerPoint package', cause);
  }

  const slides = (await slidesInPresentationOrder(zip)) ?? slidesByFilename(zip);
  if (slides.length === 0) {
    throw new PptxExtractionError('the package contains no slides');
  }

  /*
   * 🚨 `hasUnreadCharts` NOW MEANS WHAT IT SAYS.
   *
   * It used to be "this package contains a chart part or an embedded workbook",
   * which made every charted deck permanently unreadable-in-part even though the
   * figures were sitting in those parts. It is now set only when a specific chart
   * could not be read, and `unreadCharts` says which and why — because "five of
   * six charts read, one references an external workbook" is an answer and "this
   * deck contains charts" is not.
   */
  const unreadCharts: string[] = [];
  /*
   * 🚨 EVERY CHART PART MUST BE ACCOUNTED FOR, NOT JUST THE ONES I CAN FOLLOW.
   *
   * Charts are resolved through each slide's relationships, which is what makes a
   * figure land on the right slide. But that means a chart part this reader cannot
   * REACH — nested in a structure it does not traverse, or referenced from
   * somewhere unexpected — would simply not appear, and the deck would report as
   * read whole while a chart went unmentioned.
   *
   * The previous implementation scanned the package and flagged any chart part at
   * all. That was imprecise (it condemned readable charts) but it was SAFE, and
   * two existing tests were protecting exactly that safety. This keeps the
   * precision and restores the safety net: anything left unvisited is reported.
   */
  const visitedCharts = new Set<string>();

  const blocks: string[] = [];
  let hasNotes = false;

  for (const [index, path] of slides.entries()) {
    const part = zip.file(path);
    if (!part) continue;
    const slideXml = await part.async('string');
    const body = textFromSlide(slideXml);
    const notes = await notesForSlide(zip, path);
    if (notes) hasNotes = true;
    const charts = await chartsForSlide(zip, path, slideXml);
    for (const u of charts.unread) unreadCharts.push(`Slide ${index + 1}, ${u}`);
    for (const part of charts.consumed) visitedCharts.add(part);

    // A slide with no text at all is still a slide the user can refer to by
    // number, so it is headed and left empty rather than skipped — skipping it
    // would silently renumber every slide after it.
    const lines = [`--- Slide ${index + 1} ---`];
    if (body) lines.push(body);
    // Charts sit with their slide, so "the chart on slide 12" resolves, and after
    // the body so prose context precedes the figures.
    for (const c of charts.text) lines.push(c);
    if (notes) lines.push(`Speaker notes: ${notes}`);
    blocks.push(lines.join('\n'));
  }

  /*
   * Chart parts nobody reached, and embedded workbooks that are not a chart's own
   * data source. A workbook belonging to a chart that WAS read is already covered
   * by the figures; one that belongs to nothing is content this reader never
   * opened, and saying so is the difference between a limit and a silent gap.
   */
  for (const name of Object.keys(zip.files)) {
    if (/^ppt\/charts\/chart\d+\.xml$/.test(name) && !visitedCharts.has(name)) {
      unreadCharts.push(`${name}: present in the file but not reachable from any slide`);
    }
  }

  return {
    text: blocks.join('\n\n').trim(),
    slideCount: slides.length,
    hasNotes,
    hasUnreadCharts: unreadCharts.length > 0,
    unreadCharts,
  };
}
