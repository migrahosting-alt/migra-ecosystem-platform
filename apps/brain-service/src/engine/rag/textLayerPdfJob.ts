/**
 * The background job for a PDF that already carries its own text.
 *
 * 🚨 WHY IT IS SEPARATE FROM THE SCANNED JOB. The scanned pipeline exists to
 * recover order that a stack of photographs has lost: it splits spreads, reads
 * folios, and reconstructs a sequence from evidence. A digital PDF has not lost
 * anything — page 7 is page 7, stated by the file itself. Running it through
 * reconstruction would invent a problem to solve, spend minutes of OCR on text
 * that is already present, and risk "correcting" a correct order.
 *
 * So the two paths share the state machine, the runner, the indexing seam and
 * the terminal-state honesty, and differ only in how the pages are read.
 *
 * WHAT THIS UNBLOCKS. Above the synchronous extraction ceiling the indexer used
 * to skip a document outright — it was stored, honestly reported as unreadable,
 * and useless. A 35.5 MB text PDF now takes this path and becomes answerable,
 * without the synchronous parser ever seeing 35 MB: `pdftotext` reads one page
 * per subprocess, so the Brain's peak memory is a page, not a book.
 */

import { extractPdfTextPages, probePdfTextLayer, type PdfTextLayerProbe } from './pdfTextLayer.js';
import { toSearchText, type DocumentMap, type PlacedPage } from './documentMap.js';
import type { DocumentReadiness, ProcessingStage } from './documentReadiness.js';

export interface TextLayerPdfJobDeps {
  /** Persist a stage transition. MUST land before the stage's work begins. */
  report(readiness: DocumentReadiness): Promise<void>;
  now?(): number;
}

export interface TextLayerPdfJobResult {
  map: DocumentMap;
  pageCount: number;
  emptyPages: number[];
  totalCharacters: number;
}

/**
 * A page of a digital PDF, as a placed page.
 *
 * ORDER IS TAKEN FROM THE FILE, NOT INFERRED. `canonicalIndex` is the page
 * number poppler reported, and the basis says so — an honest "the document told
 * us" rather than a confidence score dressed up as evidence. `confidence: 1`
 * reflects that this is not a guess; nothing was estimated.
 *
 * `folio` is deliberately NOT set. The printed number on the page and the
 * position in the file are different claims, and only the scanned pipeline has
 * the evidence to connect them. Asserting them equal here would be a guess
 * wearing the costume of a fact.
 */
function placedFromText(page: number, text: string): PlacedPage {
  return {
    scanIndex: page,
    physicalPosition: 'single',
    canonicalIndex: page,
    state: 'confirmed',
    basis: 'file_page_order',
    evidence: `page ${page} of the PDF's own page sequence`,
    sections: [],
    chapterMarkers: [],
    confidence: 1,
    // Exact, never normalised — the same rule the OCR path follows. A document
    // may mix orthographies, and rewriting either destroys what it says.
    sourceText: text,
    indexAction: 'index',
    alternateCaptures: [],
    searchText: toSearchText(text),
  };
}

/**
 * Read a text-layer PDF page by page.
 *
 * Throws `{ failure: { kind: 'no_text_layer' } }` when the probe finds no usable
 * text, so the caller can escalate to OCR rather than indexing an empty book.
 * That shape is what `classifyFailure` in the runner already understands.
 */
export async function processTextLayerPdf(
  pdfPath: string,
  fileName: string,
  deps: TextLayerPdfJobDeps,
  probed?: PdfTextLayerProbe,
): Promise<TextLayerPdfJobResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  const stage = async (s: ProcessingStage, detail?: string, extra: Partial<DocumentReadiness> = {}) => {
    await deps.report({
      fileName, state: 'processing', stage: s, startedAt,
      ...(detail !== undefined ? { detail } : {}),
      ...extra,
    });
  };

  await stage('reading_text', 'checking for a text layer');
  const probe = probed ?? (await probePdfTextLayer(pdfPath));
  if (!probe.hasTextLayer) {
    throw Object.assign(new Error(`no usable text layer: ${probe.reason}`), {
      failure: { kind: 'no_text_layer' },
    });
  }

  const extraction = await extractPdfTextPages(pdfPath, probe.pages, {
    // Reported BEFORE each page, so a crash names the page it died on. The
    // scanned job does the same, for the same reason.
    onPage: async (page, total) => {
      await stage('reading_text', `page ${page} of ${total}`, { pagesTotal: total, pagesDone: page - 1 });
    },
  });

  const pages = extraction.pages.map((p) => placedFromText(p.page, p.text));

  return {
    map: {
      pages,
      declaredRanges: [],
      validationFailures: [],
      missingFolios: [],
      summary: { confirmed: pages.length, probable: 0, uncertain: 0, duplicates: 0 },
    },
    pageCount: probe.pages,
    emptyPages: extraction.emptyPages,
    totalCharacters: extraction.totalCharacters,
  };
}

/**
 * The terminal readiness a finished text extraction implies.
 *
 * 🚨 EMPTY PAGES ARE REPORTED, NOT ROUNDED AWAY. A PDF whose every page failed
 * to yield text is NOT ready, however cleanly the job ran — that is the
 * "succeeded while indexing nothing" failure the runner already guards against,
 * reached from this path instead. Some empty pages are normal (blank versos,
 * image plates) and do not make the document unreadable, so only a total absence
 * of text is terminal.
 */
export function readinessFromTextExtraction(
  fileName: string,
  result: TextLayerPdfJobResult,
  startedAt: number,
): DocumentReadiness {
  const readable = result.map.pages.length;
  if (readable === 0) {
    return {
      fileName,
      state: 'no_text_layer',
      startedAt,
      failureReason: 'the PDF was read but no page yielded any text',
    };
  }

  return {
    fileName,
    state: 'ready',
    stage: 'ready',
    orderedPages: readable,
    unplacedPages: 0,
    sequenceComplete: result.emptyPages.length === 0,
    startedAt,
  };
}
