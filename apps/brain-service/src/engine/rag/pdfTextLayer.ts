/**
 * Reading a PDF that already contains text, one page at a time.
 *
 * 🚨 WHY THIS EXISTS. A 35.5 MB PDF uploaded successfully, was stored, and then
 * told the user "this file is too large for MigraPilot to read yet" — truthful,
 * but a dead object in their library. The synchronous extractor refuses anything
 * over 25 MB because it loads whole files into memory inside the Brain, where one
 * large document could exhaust the process and end chat for every user.
 *
 * The fix is not a bigger constant. It is reading the document in pieces, out of
 * the request, with the bytes never accumulating in the Node heap:
 *
 *   - `pdftotext -f N -l N` extracts ONE page per subprocess. Peak memory is one
 *     page of text, not one document, and poppler does the parsing in its own
 *     address space where a malformed PDF cannot take the Brain down with it.
 *   - Progress is reported per page, so a job that dies says which page it died
 *     on rather than leaving "processing, stage unknown".
 *   - Nothing here rasterises. A PDF with a text layer needs no OCR, and
 *     spending minutes of CPU rendering pages whose text is already present was
 *     the waste that made the fast path worth protecting in the first place.
 *
 * Poppler is already installed on the host (24.02.0) and already relied on by
 * the scanned-PDF job, so this adds capability without adding a dependency.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';

import { extractPdf } from './pdfText.js';
import { DEFAULT_MAX_INDEX_FILE_BYTES } from './fsFileSource.js';

const run = promisify(execFile);

/**
 * Did this fail because the EXECUTABLE is absent, rather than because the
 * document is bad?
 *
 * One implementation of the distinction, so no caller grows a private copy that
 * drifts from it. Each caller passes the binaries IT cares about, because the
 * sets genuinely differ: the failure classifier asks about the rasteriser and
 * the recogniser, while this module asks about the two text binaries it is the
 * only user of.
 */
export function binaryMissing(error: unknown, binaries: RegExp): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  // The binary name and ENOENT can appear in either order — Node reports
  // "spawn pdftotext ENOENT" — so neither is assumed to come first.
  return /ENOENT/i.test(message) && binaries.test(message);
}

/** The poppler binaries THIS module shells out to. */
const POPPLER_TEXT = /(pdfinfo|pdftotext)/i;

/**
 * The in-process reading of ONE document, held only while it is the document
 * being read.
 *
 * The job runner is serial by design — one document at a time — so a single
 * entry is exactly the working set, and re-parsing the whole PDF once per page
 * would turn a page-by-page read into quadratic work over the same bytes.
 */
let memo: { key: string; pages: string[] } | null = null;

/**
 * Read the pages WITHOUT poppler, when poppler is not installed here.
 *
 * 🚨 WHY THIS EXISTS. `probePdfTextLayer` calls `pdfPageCount` — `pdfinfo` — as
 * its very first step. On a host with no poppler that throws before the
 * document's content is examined at all, the probe is read as "no text layer",
 * and the document falls through to the scanned pipeline, which then fails on
 * the missing rasteriser. The user is told "the page renderer is not available
 * on this server" about a PDF whose text was sitting right there, readable by a
 * library already in this service's dependencies. Measured on staging: a 5 KB,
 * five-page digital contract reported unreadable in Files while chat answered
 * six questions from it correctly.
 *
 * So the contract of this module — reading a PDF that already carries its text —
 * is honoured wherever the service runs, which is what `documentReaderCapability`
 * has always DECLARED by reporting `pdf_text_extraction` as in-process and
 * therefore always available. This makes the pipeline match that claim.
 *
 * 🚨 BOUNDED, AND HONEST WHEN IT CANNOT HELP. In-process parsing holds the whole
 * document in the Node heap — the exact cost `pdftotext` was chosen to avoid —
 * so it stops at the same ceiling the synchronous extractor uses. Above it the
 * ORIGINAL poppler error is rethrown, because then `reader_unavailable` is
 * simply true: this host really cannot read that document.
 */
async function inProcessPages(pdfPath: string, popplerError: unknown): Promise<string[]> {
  const info = await stat(pdfPath);
  const key = `${pdfPath}|${info.size}|${info.mtimeMs}`;
  if (memo?.key === key) return memo.pages;

  if (info.size > DEFAULT_MAX_INDEX_FILE_BYTES) throw popplerError;

  let pages: string[];
  try {
    const extraction = await extractPdf(new Uint8Array(await readFile(pdfPath)));
    pages = extraction.pages.map((p) => p.text);
  } catch (error) {
    /*
     * 🚨 "NO TEXT LAYER" IS AN ANSWER, NOT A FAILURE, TO THE QUESTION ASKED HERE.
     *
     * An image-only PDF still HAS pages; what it lacks is text on them. Letting
     * that throw would make `pdfPageCount` fail on a scan and leave the probe
     * escalating to OCR only because its caller swallows every error — the
     * right destination reached by accident. Returning the pages it does have,
     * empty, lets the probe answer `hasTextLayer: false` on the evidence and
     * send the document to OCR deliberately.
     *
     * Every other classified failure — encrypted, corrupt — is a real failure
     * about the document and propagates untouched.
     */
    const failure = (error as { failure?: { kind?: string; pages?: number } })?.failure;
    if (failure?.kind !== 'no_text_layer') throw error;
    pages = Array.from({ length: failure.pages ?? 0 }, () => '');
  }
  memo = { key, pages };
  return pages;
}

/**
 * How much text a page must hold to count as "really there".
 *
 * A scanned PDF often carries a thin text layer — a few stray characters from a
 * failed OCR pass, or a header stamped by the scanner. Treating that as a
 * readable text layer would skip OCR and index almost nothing, which is the
 * silent-drop failure this pipeline exists to prevent. The threshold is
 * deliberately low: it separates "a handful of artefacts" from "a page of
 * prose", not "sparse" from "dense".
 */
const MIN_CHARS_PER_PAGE = 120;

/**
 * A single page holding this much text proves a text layer on its own.
 *
 * 🚨 THE MEAN WAS THE BUG. A 40 MB digital PDF — large because it embeds
 * images, which is what makes any PDF that size — was classified as having NO
 * text layer, sent to OCR, and reported as "the pages were rendered but no
 * readable text was recovered". Averaging three pages punishes exactly the
 * documents most likely to be large: a title page, a full-page image and one
 * dense page average below the bar while the document is plainly readable.
 *
 * A page carrying 200+ characters is a paragraph, not a scanner artefact — the
 * thing the mean test was protecting against. A stray header stamped on a scan
 * does not reach it, so this widens what counts as readable without letting a
 * scan skip the OCR it needs.
 */
const STRONG_PAGE_CHARS = 200;

/**
 * Pages sampled when deciding whether a text layer exists at all.
 *
 * Raised from 3. Sampling is cheap — one `pdftotext` per page against a text
 * layer is milliseconds — and choosing wrongly costs either an hour of
 * unnecessary OCR or a readable document declared unreadable.
 */
const PROBE_PAGES = 8;

/**
 * A page cannot legitimately hold this much text, so something is wrong —
 * a font that decodes to garbage, or a PDF built to be a decompression bomb.
 * Truncating bounds the damage while keeping what was read.
 */
const MAX_CHARS_PER_PAGE = 400_000;

export interface PdfTextPage {
  /** 1-based, as poppler counts. */
  page: number;
  text: string;
}

export interface PdfTextLayerProbe {
  pages: number;
  /** Whether page-by-page text extraction is worth doing at all. */
  hasTextLayer: boolean;
  /** Mean characters per sampled page — evidence for the decision above. */
  sampledCharsPerPage: number;
  reason: string;
}

/** Page count, from poppler rather than from parsing the file ourselves. */
export async function pdfPageCount(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await run('pdfinfo', [pdfPath], { maxBuffer: 4 * 1024 * 1024 });
    return Number(/Pages:\s+(\d+)/.exec(stdout)?.[1] ?? 0);
  } catch (error) {
    // Only a MISSING binary falls back. A pdfinfo that ran and failed is telling
    // us something about the document, and must not be overruled.
    if (!binaryMissing(error, POPPLER_TEXT)) throw error;
    return (await inProcessPages(pdfPath, error)).length;
  }
}

/** One page of text. Its own subprocess, so peak memory is one page. */
export async function extractPdfPageText(pdfPath: string, page: number): Promise<string> {
  const cap = (text: string): string =>
    text.length > MAX_CHARS_PER_PAGE ? text.slice(0, MAX_CHARS_PER_PAGE) : text;

  try {
    const { stdout } = await run(
      'pdftotext',
      ['-f', String(page), '-l', String(page), '-enc', 'UTF-8', '-q', pdfPath, '-'],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return cap(stdout);
  } catch (error) {
    if (!binaryMissing(error, POPPLER_TEXT)) throw error;
    // 1-based, as poppler counts, so the fallback indexes the same page the
    // caller asked poppler for.
    return cap((await inProcessPages(pdfPath, error))[page - 1] ?? '');
  }
}

/**
 * Is there a real text layer here?
 *
 * DECIDED FROM EVIDENCE, NOT FROM THE EXTENSION — the same rule the OCR
 * escalation already follows. A few pages are sampled rather than all of them,
 * because the answer is a property of how the document was made and reading 400
 * pages to learn it would cost more than the extraction itself.
 *
 * SAMPLES FROM THE MIDDLE, not the front. Page 1 of a scanned book is very often
 * a cover or a title page with almost no text, and judging the whole document by
 * it would send text-layer PDFs down the OCR path for no reason.
 */
export async function probePdfTextLayer(pdfPath: string): Promise<PdfTextLayerProbe> {
  const pages = await pdfPageCount(pdfPath);
  if (pages <= 0) {
    return { pages: 0, hasTextLayer: false, sampledCharsPerPage: 0, reason: 'the PDF reports no pages' };
  }

  /*
   * SPREAD ACROSS THE DOCUMENT, not clustered. Front matter is unrepresentative
   * in both directions — a scan's cover is blank, a report's title page is the
   * only text — so the sample walks the whole book and includes the middle,
   * where ordinary body pages live.
   */
  const step = Math.max(1, Math.floor(pages / PROBE_PAGES));
  const spread = Array.from({ length: PROBE_PAGES }, (_, i) => 1 + i * step).filter((p) => p <= pages);
  const middle = Math.max(1, Math.floor(pages / 2));
  const sampled = [...new Set([middle, ...spread])].slice(0, PROBE_PAGES).sort((a, b) => a - b);

  let total = 0;
  let strongest = 0;
  for (const page of sampled) {
    // A page that fails to extract counts as zero rather than aborting the
    // probe: one broken page must not send a whole readable document to OCR.
    const chars = (await extractPdfPageText(pdfPath, page).catch(() => '')).trim().length;
    total += chars;
    if (chars > strongest) strongest = chars;
  }
  const mean = sampled.length > 0 ? total / sampled.length : 0;

  /*
   * EITHER signal is enough. A consistently texty document passes on the mean;
   * a document that is mostly images with real prose on some pages passes on
   * the strongest page. Requiring the mean alone is what failed the 40 MB
   * digital PDF.
   */
  const hasTextLayer = mean >= MIN_CHARS_PER_PAGE || strongest >= STRONG_PAGE_CHARS;

  return {
    pages,
    hasTextLayer,
    sampledCharsPerPage: Math.round(mean),
    reason: hasTextLayer
      ? `sampled ${sampled.length} pages: mean ${Math.round(mean)} characters, best page ${strongest}`
      : `sampled ${sampled.length} pages: mean only ${Math.round(mean)} characters and best page only ${strongest}, so the text layer is absent or unusable`,
  };
}

export interface PdfTextExtractionDeps {
  /**
   * Called BEFORE each page is read, so a crash points at the page it died on
   * rather than at the last one that succeeded. This is the same ordering the
   * scanned job uses, for the same reason.
   */
  onPage?(page: number, total: number): Promise<void>;
}

export interface PdfTextExtraction {
  pages: PdfTextPage[];
  /** Pages that produced nothing readable — reported, never silently dropped. */
  emptyPages: number[];
  totalCharacters: number;
}

/**
 * Read every page's text, in order, one subprocess at a time.
 *
 * SEQUENTIAL ON PURPOSE. Parallel extraction would multiply peak memory and
 * contend with chat on the same box for no wall-clock benefit that matters —
 * this already runs in the background, where being unobtrusive beats being fast.
 *
 * A page that fails is recorded as empty and the run continues. One unreadable
 * page in a 400-page book must not discard the other 399, and the empty list is
 * what lets the terminal state say so honestly.
 */
export async function extractPdfTextPages(
  pdfPath: string,
  totalPages: number,
  deps: PdfTextExtractionDeps = {},
): Promise<PdfTextExtraction> {
  const pages: PdfTextPage[] = [];
  const emptyPages: number[] = [];
  let totalCharacters = 0;

  for (let page = 1; page <= totalPages; page += 1) {
    await deps.onPage?.(page, totalPages);
    const text = await extractPdfPageText(pdfPath, page).catch(() => '');
    if (text.trim().length === 0) {
      emptyPages.push(page);
      continue;
    }
    pages.push({ page, text });
    totalCharacters += text.length;
  }

  return { pages, emptyPages, totalCharacters };
}
