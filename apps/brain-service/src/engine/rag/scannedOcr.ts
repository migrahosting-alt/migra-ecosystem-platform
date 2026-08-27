/**
 * OCR for scanned PDFs — an ESCALATION PATH, never the default.
 *
 *   PDF -> text layer present  -> unpdf (fast, exact, free)
 *       -> no text layer       -> here
 *
 * The measured facts this is built on, all taken on the deploy target against
 * the Haitian Creole scan rather than assumed:
 *
 *  - Native Tesseract and the WASM build are structurally INDISTINGUISHABLE at
 *    matched settings (diacritics 14/14, 34/35, 54/54). Native is 25-30% faster
 *    and needs no runtime language download, so native wins on cost alone.
 *  - `hat` preserves more Haitian diacritics than `fra` (35 v 22, 14 v 10).
 *  - 🚨 NO SINGLE SEGMENTATION MODE READS THE BOOK. On a grammar page psm 3
 *    recovers the folio and all five numbered sections while destroying the
 *    vocabulary columns; psm 6 recovers the French-to-Creole pairs exactly and
 *    loses that same folio and every section number. Those are the signals page
 *    reconstruction depends on.
 *
 * So the mode is CHOSEN per page from a cheap pre-OCR layout analysis, the
 * result is VALIDATED against what that layout should have produced, and the
 * other mode runs only when the first fails its own check. Two passes on every
 * page would be correct and wasteful; one fixed mode would be cheap and wrong.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyseLayout, type LayoutAnalysis, type PageLayout } from './pageLayout.js';

const run = promisify(execFile);

/** Tesseract page segmentation modes, named for what they are good at here. */
export const PSM_AUTO = '3';   // finds the folio and numbered sections
export const PSM_BLOCK = '6';  // keeps multi-column rows together

export type PhysicalPosition = 'left' | 'right' | 'single';

export interface OcrPass {
  psm: string;
  text: string;
  /** Mean per-word confidence, 0-100, from Tesseract's own TSV output. */
  confidence: number;
  words: number;
  ms: number;
}

/**
 * Everything recovered about one physical page.
 *
 * BOTH OCR products are kept when both run. Merging them into a single "best"
 * string would throw away the evidence that makes reconstruction possible: psm 3
 * holds the folio and section numbers, psm 6 holds the column relationships, and
 * whichever is chosen as `selectedText` the other still answers questions the
 * winner cannot.
 */
export interface ScannedPageRecord {
  scanIndex: number;
  /** WHERE ON THE SHEET, never "reading order" — those are different questions. */
  physicalPosition: PhysicalPosition;
  layout: PageLayout;
  layoutReason: string;
  passes: OcrPass[];
  selectedPsm: string;
  selectionReason: string;
  /**
   * The transcript exactly as OCR recovered it.
   *
   * NEVER normalised. This book mixes older French-influenced Creole ("Lor ou
   * lan pays blanc") with the modern orthography, and rewriting the old forms
   * would silently destroy what the page actually says. Any search-normalised
   * spelling belongs in a separate derived field.
   */
  selectedText: string;
  folioCandidates: number[];
  sectionCandidates: string[];
  chapterMarkers: string[];
  columnPairs: number;
  confidence: number;
}

/** Numbers that stand alone on a line — a printed page number, most likely. */
function folioCandidates(text: string): number[] {
  const found = new Set<number>();
  for (const line of text.split('\n')) {
    const m = /^\s*(\d{1,3})\s*$/.exec(line);
    if (m) found.add(Number(m[1]));
  }
  return [...found];
}

/** Section markers such as "18-", "27.1-", "30-". */
function sectionCandidates(text: string): string[] {
  return [...new Set((text.match(/^\s*\d{1,3}(?:\.\d{1,2})?-/gm) ?? []).map((s) => s.trim()))];
}

function chapterMarkers(text: string): string[] {
  return [...new Set((text.match(/\bCHAPIT\s+\d+|\bPREMY[EÈ]\s+PATI\b/gi) ?? []).map((s) => s.trim()))];
}

/**
 * Rows that look like a French/Creole pair — two or more entries on one line.
 *
 * Counted rather than parsed: the question here is only "did the column
 * structure survive this pass", and a count answers it without committing to a
 * column model that the reconstruction step will do properly.
 */
function columnPairRows(text: string): number {
  let rows = 0;
  for (const line of text.split('\n')) {
    const cells = line.trim().split(/\s{2,}/).filter((c) => c.length > 1);
    if (cells.length >= 2) rows += 1;
  }
  return rows;
}

/** Which mode a layout should be tried with first. */
export function preferredPsm(layout: PageLayout): string {
  return layout === 'vocabulary_columns' ? PSM_BLOCK : PSM_AUTO;
}

/**
 * Did this pass recover what its layout promised?
 *
 * A pass is NOT accepted merely because it returned a lot of words — that is the
 * check that would have hidden the segmentation problem entirely, since both
 * modes return plenty of words on every page.
 */
export function passSatisfiesLayout(layout: PageLayout, record: {
  folioCandidates: number[];
  sectionCandidates: string[];
  chapterMarkers: string[];
  columnPairs: number;
  text: string;
}): boolean {
  switch (layout) {
    case 'vocabulary_columns':
      // The whole reason this page took psm 6: the pairs must be on shared rows.
      return record.columnPairs >= 5;
    case 'chapter_title':
      return record.chapterMarkers.length > 0 || record.text.trim().length > 20;
    case 'prose':
      /*
       * A page of text should yield SOME placement signal — a folio or a section
       * number. Requiring both would fail honest pages whose folio the binding
       * curl cut off, which is a real page in this scan, not a hypothetical.
       */
      return record.folioCandidates.length > 0 || record.sectionCandidates.length > 0;
    default:
      return record.text.trim().length > 0;
  }
}

async function ocrOnce(imagePath: string, language: string, psm: string): Promise<OcrPass> {
  const started = Date.now();
  const base = `${imagePath}.psm${psm}`;
  // TSV carries per-word confidence and bounding boxes; the plain transcript is
  // derived from it so the two can never describe different recognitions.
  await run('tesseract', [imagePath, base, '-l', language, '--psm', psm, 'tsv'], { maxBuffer: 64 * 1024 * 1024 });
  const tsv = await readFile(`${base}.tsv`, 'utf8');

  const rows = tsv.split('\n').slice(1).map((r) => r.split('\t'));
  const words = rows.filter((r) => r.length >= 12 && (r[11] ?? '').trim().length > 0);
  const confidences = words.map((r) => Number(r[10])).filter((n) => Number.isFinite(n) && n >= 0);

  // Rebuild lines from block/paragraph/line numbers so column structure survives.
  const lines = new Map<string, string[]>();
  for (const r of words) {
    const key = `${r[2]}|${r[3]}|${r[4]}`;
    (lines.get(key) ?? lines.set(key, []).get(key)!).push((r[11] ?? '').trim());
  }
  const text = [...lines.values()].map((w) => w.join(' ')).join('\n');

  return {
    psm,
    text,
    confidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0,
    words: words.length,
    ms: Date.now() - started,
  };
}

function summarise(pass: OcrPass) {
  return {
    folioCandidates: folioCandidates(pass.text),
    sectionCandidates: sectionCandidates(pass.text),
    chapterMarkers: chapterMarkers(pass.text),
    columnPairs: columnPairRows(pass.text),
    text: pass.text,
  };
}

export interface OcrPageOptions {
  scanIndex: number;
  physicalPosition: PhysicalPosition;
  language?: string;
}

/**
 * OCR one physical page: classify, run the likely mode, validate, escalate.
 *
 * A blank half returns immediately with no OCR at all. On this book most spreads
 * have one, so skipping them is not a micro-optimisation — it is close to half
 * the corpus.
 */
export async function ocrPage(pngBytes: Buffer, options: OcrPageOptions): Promise<ScannedPageRecord> {
  const analysis: LayoutAnalysis = analyseLayout(pngBytes);
  const language = options.language ?? 'hat';

  const empty = (reason: string): ScannedPageRecord => ({
    scanIndex: options.scanIndex,
    physicalPosition: options.physicalPosition,
    layout: analysis.layout,
    layoutReason: analysis.reason,
    passes: [],
    selectedPsm: 'none',
    selectionReason: reason,
    selectedText: '',
    folioCandidates: [],
    sectionCandidates: [],
    chapterMarkers: [],
    columnPairs: 0,
    confidence: 0,
  });

  if (analysis.layout === 'blank') return empty('blank half — no OCR attempted');

  const dir = await mkdtemp(join(tmpdir(), 'migrapilot-ocr-'));
  try {
    const imagePath = join(dir, 'page.png');
    await writeFile(imagePath, pngBytes);

    const first = preferredPsm(analysis.layout);
    const passes: OcrPass[] = [await ocrOnce(imagePath, language, first)];
    let chosen = passes[0]!;
    let reason = `layout ${analysis.layout} prefers psm ${first}`;

    if (!passSatisfiesLayout(analysis.layout, summarise(chosen))) {
      /*
       * The preferred mode did not recover what this layout is supposed to hold,
       * so the other mode runs. This is the ONLY case that costs two passes, and
       * it is the case where one pass would have quietly lost the evidence.
       */
      const alternate = first === PSM_AUTO ? PSM_BLOCK : PSM_AUTO;
      const second = await ocrOnce(imagePath, language, alternate);
      passes.push(second);
      if (passSatisfiesLayout(analysis.layout, summarise(second))) {
        chosen = second;
        reason = `psm ${first} failed its structural check; psm ${alternate} satisfied it`;
      } else {
        // Neither satisfied the check. Keep the more confident transcript and say
        // so — a page nobody can validate must not look like a clean read.
        chosen = second.confidence > chosen.confidence ? second : chosen;
        reason = `neither psm satisfied the ${analysis.layout} check; kept the higher-confidence pass`;
      }
    }

    const summary = summarise(chosen);
    return {
      scanIndex: options.scanIndex,
      physicalPosition: options.physicalPosition,
      layout: analysis.layout,
      layoutReason: analysis.reason,
      passes,
      selectedPsm: chosen.psm,
      selectionReason: reason,
      selectedText: chosen.text,
      folioCandidates: summary.folioCandidates,
      sectionCandidates: summary.sectionCandidates,
      chapterMarkers: summary.chapterMarkers,
      columnPairs: summary.columnPairs,
      confidence: chosen.confidence,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
