/**
 * The background job that turns a scanned PDF into readable, ordered pages.
 *
 *   rasterise -> split spreads -> adaptive OCR -> reconstruct -> index
 *
 * Every stage transition is WRITTEN DOWN before the stage begins, not after it
 * finishes. A job that dies mid-OCR must leave behind the fact that it was
 * reading text, because "processing, stage unknown" is indistinguishable from a
 * job that never started and would be resumed from the wrong place.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ocrPage, type ScannedPageRecord, type PhysicalPosition } from './scannedOcr.js';
import { reconstructDocument, type DocumentMap } from './documentMap.js';
import type { DocumentReadiness, ProcessingStage } from './documentReadiness.js';

const run = promisify(execFile);

/** Rasterisation resolution. 300dpi is what the OCR qualification measured. */
const RENDER_DPI = 300;

export interface ScannedPdfJobDeps {
  /** Persist a stage transition. MUST land before the stage's work begins. */
  report(readiness: DocumentReadiness): Promise<void>;
  /** Wall clock, injected so tests are not timing-dependent. */
  now?(): number;
}

export interface ScannedPdfJobResult {
  map: DocumentMap;
  records: ScannedPageRecord[];
  pageCount: number;
}

/** Page geometry, needed to decide whether a scan holds one page or two. */
async function pdfGeometry(pdfPath: string): Promise<{ pages: number; landscape: boolean }> {
  const { stdout } = await run('pdfinfo', [pdfPath], { maxBuffer: 4 * 1024 * 1024 });
  const pages = Number(/Pages:\s+(\d+)/.exec(stdout)?.[1] ?? 0);
  const size = /Page size:\s+([\d.]+)\s+x\s+([\d.]+)/.exec(stdout);
  const width = Number(size?.[1] ?? 0);
  const height = Number(size?.[2] ?? 0);
  return { pages, landscape: width > height * 1.05 };
}

/**
 * Render one scan, splitting a landscape sheet into its two physical halves.
 *
 * A landscape page in a book scan is almost always a SPREAD — two pages
 * photographed together — and OCR-ing it whole merges two unrelated pages into a
 * single chunk. The halves keep their side, because where a page sat on the
 * sheet is a fact worth recording even though it says nothing about reading
 * order: in this book the right half is consistently the EARLIER page.
 */
async function renderScan(
  pdfPath: string, dir: string, index: number, landscape: boolean,
): Promise<Array<{ path: string; position: PhysicalPosition }>> {
  const out: Array<{ path: string; position: PhysicalPosition }> = [];
  if (!landscape) {
    const base = join(dir, `s${index}-single`);
    await run('pdftoppm', ['-r', String(RENDER_DPI), '-png', '-f', String(index), '-l', String(index), pdfPath, base]);
    const produced = (await readdir(dir)).filter((f) => f.startsWith(`s${index}-single`));
    for (const f of produced) out.push({ path: join(dir, f), position: 'single' });
    return out;
  }

  // Width in pixels at the render resolution, halved at the gutter.
  const { stdout } = await run('pdfinfo', ['-f', String(index), '-l', String(index), pdfPath]);
  const size = /Page size:\s+([\d.]+)\s+x\s+([\d.]+)/.exec(stdout);
  const widthPx = Math.round((Number(size?.[1] ?? 0) / 72) * RENDER_DPI);
  const heightPx = Math.round((Number(size?.[2] ?? 0) / 72) * RENDER_DPI);
  const half = Math.floor(widthPx / 2);

  for (const [position, x] of [['right', half], ['left', 0]] as const) {
    const base = join(dir, `s${index}-${position}`);
    await run('pdftoppm', [
      '-r', String(RENDER_DPI), '-png', '-f', String(index), '-l', String(index),
      '-x', String(x), '-y', '0', '-W', String(half), '-H', String(heightPx), pdfPath, base,
    ]);
    const produced = (await readdir(dir)).filter((f) => f.startsWith(`s${index}-${position}`));
    for (const f of produced) out.push({ path: join(dir, f), position });
  }
  return out;
}

/**
 * Run the whole pipeline for one document.
 *
 * Throws only on faults the caller must handle (an unreadable PDF, a missing
 * rasteriser). A page that simply yields nothing is not an error — this book has
 * nineteen blank halves — and treating it as one would fail a document that is
 * perfectly readable.
 */
export async function processScannedPdf(
  pdfPath: string,
  fileName: string,
  deps: ScannedPdfJobDeps,
): Promise<ScannedPdfJobResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  const stage = async (s: ProcessingStage, detail?: string, extra: Partial<DocumentReadiness> = {}) => {
    await deps.report({
      fileName, state: 'processing', stage: s, startedAt,
      ...(detail !== undefined ? { detail } : {}),
      ...extra,
    });
  };

  await stage('rendering_pages');
  const { pages, landscape } = await pdfGeometry(pdfPath);
  const dir = await mkdtemp(join(tmpdir(), 'migrapilot-scan-'));

  try {
    const halves: Array<{ path: string; position: PhysicalPosition; scanIndex: number }> = [];
    for (let i = 1; i <= pages; i += 1) {
      await stage('rendering_pages', `scan ${i} of ${pages}`, { pagesTotal: pages, pagesDone: i - 1 });
      for (const h of await renderScan(pdfPath, dir, i, landscape)) {
        halves.push({ ...h, scanIndex: i });
      }
    }

    const records: ScannedPageRecord[] = [];
    for (let i = 0; i < halves.length; i += 1) {
      const h = halves[i]!;
      // Reported BEFORE the work, so a crash points at the page it died on.
      await stage('reading_text', `page ${i + 1} of ${halves.length}`, {
        pagesTotal: halves.length, pagesDone: i,
      });
      records.push(await ocrPage(await readFile(h.path), {
        scanIndex: h.scanIndex, physicalPosition: h.position,
      }));
    }

    await stage('reconstructing_order', undefined, { pagesTotal: halves.length, pagesDone: halves.length });
    const map = reconstructDocument(records);

    return { map, records, pageCount: halves.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The terminal readiness a finished map implies.
 *
 * Separated from the run so the decision is testable without OCR, and so the
 * distinction that matters cannot be fudged: a document with unplaced pages is
 * READY — its content is fully usable — but its sequence is not complete, and
 * `sequenceComplete` records that as a fact retrieval can act on.
 */
export function readinessFromMap(fileName: string, map: DocumentMap, startedAt: number): DocumentReadiness {
  const ordered = map.pages.filter((p) => p.indexAction === 'index').length;
  const unplaced = map.pages.filter((p) => p.indexAction === 'index_unplaced').length;

  if (ordered === 0 && unplaced === 0) {
    return {
      fileName, state: 'ocr_failed', startedAt,
      failureReason: 'the pages were rendered but no readable text was recovered',
    };
  }

  return {
    fileName,
    state: unplaced > 0 ? 'ready_with_unplaced_pages' : 'ready',
    stage: 'ready',
    orderedPages: ordered,
    unplacedPages: unplaced,
    sequenceComplete: unplaced === 0,
    startedAt,
  };
}
