/**
 * Runs scanned-PDF jobs one at a time, and tells the truth about them.
 *
 * Serialised on purpose. Each job pins a CPU for minutes — 569 seconds for a
 * 28-scan book — and running several concurrently would starve chat on the same
 * box. A queue that makes one user wait is better than a service that makes
 * everyone wait.
 *
 * The in-memory queue is deliberately NOT the source of truth. It is lost on
 * restart; the readiness rows are not, which is why boot recovery reads the
 * database rather than asking this class what it was doing.
 */

import { processScannedPdf, readinessFromMap } from './scannedPdfJob.js';
import {
  processTextLayerPdf,
  readinessFromTextExtraction,
  type TextLayerPdfJobResult,
} from './textLayerPdfJob.js';
import { probePdfTextLayer } from './pdfTextLayer.js';
import { findRegisteredArtifact, hashFile } from './artifactReuse.js';
import { processRegisteredArtifact, readinessFromReuse } from './reusedArtifactJob.js';
import type { DocumentReadiness } from './documentReadiness.js';
import type { DocumentMap } from './documentMap.js';

export interface JobScope {
  ownerScope: string;
  workspaceScope: string;
}

export interface DocumentJobDeps {
  /** Durable write of the current readiness. */
  persist(scope: JobScope, readiness: DocumentReadiness): Promise<void>;
  /** Called once a document is readable, so its pages can be indexed. */
  index?(scope: JobScope, fileName: string, map: DocumentMap): Promise<void>;
  /**
   * How many SEARCHABLE chunks now exist for this document.
   *
   * The terminal state is not allowed to be optimistic. Reconstruction finishing
   * says the pages were read; it says nothing about whether anything can be
   * retrieved, and those came apart in production — the job reported a readable
   * book while the index held zero chunks for it.
   */
  countIndexedChunks?(scope: JobScope, fileName: string): Promise<number>;
  now?(): number;
}

interface QueuedJob {
  scope: JobScope;
  fileName: string;
  pdfPath: string;
}

const key = (scope: JobScope, fileName: string) => `${scope.ownerScope}|${scope.workspaceScope}|${fileName}`;

export class DocumentJobRunner {
  private readonly queue: QueuedJob[] = [];
  private readonly queued = new Set<string>();
  private running: string | undefined;
  private draining = false;

  constructor(private readonly deps: DocumentJobDeps) {}

  /** Documents this process is actively handling — boot recovery must skip them. */
  activeJobs(): Set<string> {
    const names = new Set<string>();
    for (const job of this.queue) names.add(job.fileName);
    if (this.running) names.add(this.running.split('|').slice(2).join('|'));
    return names;
  }

  /**
   * Accept a document for processing.
   *
   * Returns immediately, having FIRST recorded that the work is pending. If the
   * caller's request ends here — which is the whole point — the user must still
   * find a truthful state waiting for them, not an absent one.
   */
  async enqueue(scope: JobScope, fileName: string, pdfPath: string): Promise<void> {
    const id = key(scope, fileName);
    if (this.queued.has(id) || this.running === id) return;

    this.queued.add(id);
    this.queue.push({ scope, fileName, pdfPath });
    /*
     * 🚨 QUEUED, NOT PROCESSING. The queue is serial — each job pins a CPU for
     * minutes — so a document accepted while another is running has not started
     * and may not for a long time. Writing `processing` here told every waiting
     * user that work was happening on their file, and made a stalled queue
     * indistinguishable from slow progress.
     */
    await this.deps.persist(scope, {
      fileName,
      state: 'queued',
      stage: 'waiting_for_a_free_worker',
      startedAt: (this.deps.now ?? Date.now)(),
    });

    // Not awaited: the caller's request must return now, not in nine minutes.
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        const id = key(job.scope, job.fileName);
        this.queued.delete(id);
        this.running = id;
        try {
          await this.runOne(job);
        } catch (error) {
          /*
           * A failed job must leave a TERMINAL state. Leaving it `processing`
           * would show "Reading…" forever for work that has already stopped —
           * the failure boot recovery exists to clean up, arriving here instead
           * through the front door.
           */
          await this.deps.persist(job.scope, {
            fileName: job.fileName,
            state: classifyFailure(error),
            failureReason: describeFailure(error),
          }).catch(() => {});
        } finally {
          this.running = undefined;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async runOne(job: QueuedJob): Promise<void> {
    const startedAt = (this.deps.now ?? Date.now)();
    const report = (readiness: DocumentReadiness) => this.deps.persist(job.scope, readiness);
    const clock = this.deps.now ? { now: this.deps.now } : {};

    /*
     * 🚨 WHICH PIPELINE, DECIDED FROM THE DOCUMENT — NOT FROM ITS SIZE OR NAME.
     *
     * A PDF that already contains text is read with `pdftotext`, one page per
     * subprocess: seconds of work, a page of peak memory, and an order the file
     * states rather than one we infer. A PDF without a text layer still gets the
     * full scanned pipeline — rasterise, OCR, reconstruct — because for those the
     * order genuinely is lost and recovering it is the whole job.
     *
     * Choosing wrongly is expensive in both directions: OCR on a digital PDF
     * burns minutes to recover text that was already there, and text extraction
     * on a scan silently indexes a handful of scanner artefacts as if they were
     * the book. So the probe samples actual pages and the fallback below covers
     * the case where it was too optimistic.
     */
    /*
     * 🚨 HAVE WE ALREADY READ THESE EXACT BYTES?
     *
     * Asked FIRST, before any probing or rendering, because the cheapest work is
     * the work not done. `liv_kreyol_AI-Training.pdf` is a 245-page scan whose
     * OCR was already paid for once; without this it would be paid for again,
     * from zero, every time it is uploaded.
     *
     * Identity is the SHA-256 of the bytes, never the filename — a name is a
     * label a user can change, and two different books can share one. Reuse is
     * an optimisation, so every failure here falls through to real ingestion
     * rather than failing the document.
     */
    await this.deps.persist(job.scope, {
      fileName: job.fileName, state: 'processing', stage: 'matching_known_source', startedAt,
    });
    const digest = await hashFile(job.pdfPath).catch(() => null);
    const known = digest ? await findRegisteredArtifact(digest) : null;

    if (known) {
      const reused = await processRegisteredArtifact(known, job.fileName, { report, ...clock });
      await this.indexAndFinish(job, reused.map, startedAt,
        readinessFromReuse(job.fileName, reused, startedAt));
      return;
    }

    const probe = await probePdfTextLayer(job.pdfPath).catch(() => null);

    let map: DocumentMap;
    let textResult: TextLayerPdfJobResult | null = null;

    if (probe?.hasTextLayer) {
      try {
        textResult = await processTextLayerPdf(job.pdfPath, job.fileName, { report, ...clock }, probe);
        map = textResult.map;
      } catch (error) {
        /*
         * The probe sampled three pages and was wrong about the rest. Falling
         * back to OCR is strictly better than failing: the document is readable
         * either way, and the user should not have to know which internal route
         * recovered it.
         */
        if ((error as { failure?: { kind?: string } })?.failure?.kind !== 'no_text_layer') throw error;
        textResult = null;
        map = (await processScannedPdf(job.pdfPath, job.fileName, { report, ...clock })).map;
      }
    } else {
      map = (await processScannedPdf(job.pdfPath, job.fileName, { report, ...clock })).map;

      /*
       * 🚨 OCR RECOVERED NOTHING — TRY THE TEXT LAYER BEFORE GIVING UP.
       *
       * A 40 MB digital PDF was probed as having no text layer, sent to OCR, and
       * reported to the user as "the pages were rendered but no readable text was
       * recovered" — a readable document declared unreadable. The probe has been
       * widened, but a probe is a SAMPLE and will always be wrong on some
       * document; the honest safety net is to check the cheap path before
       * reporting failure, because "OCR found nothing" and "there is nothing to
       * find" are different claims.
       *
       * Costs nothing on a genuine scan: extraction of a page with no text layer
       * returns empty in milliseconds, and the result is the same failure it was
       * already heading for.
       */
      if (map.pages.length === 0) {
        await report({
          fileName: job.fileName, state: 'processing', stage: 'reading_text', startedAt,
          detail: 'OCR recovered nothing; checking for a text layer',
        });
        const salvage = await processTextLayerPdf(job.pdfPath, job.fileName, { report, ...clock })
          .catch(() => null);
        if (salvage && salvage.map.pages.length > 0) {
          textResult = salvage;
          map = salvage.map;
        }
      }
    }

    /*
     * The terminal state comes from whichever pipeline actually ran. A text
     * extraction has no unplaced pages and no folio reconstruction to report, so
     * judging it with the scanned job's rules would describe work that never
     * happened.
     */
    const terminal = textResult
      ? readinessFromTextExtraction(job.fileName, textResult, startedAt)
      : readinessFromMap(job.fileName, map, startedAt);

    await this.indexAndFinish(job, map, startedAt, terminal);
  }

  /**
   * Index the recovered pages and write the terminal state.
   *
   * SHARED BY ALL THREE PATHS — reuse, text layer and OCR — so the guarantee
   * below cannot hold for two of them and quietly lapse for the third. A reused
   * artifact is exactly as capable of indexing nothing as a freshly OCR'd one.
   */
  private async indexAndFinish(
    job: QueuedJob,
    map: DocumentMap,
    startedAt: number,
    terminal: DocumentReadiness,
  ): Promise<void> {
    if (this.deps.index) {
      await this.deps.persist(job.scope, {
        fileName: job.fileName, state: 'processing', stage: 'indexing', startedAt,
      });
      await this.deps.index(job.scope, job.fileName, map);
    }

    /*
     * READY IS EARNED, NOT ASSUMED.
     *
     * A state claiming the document is readable while nothing is searchable is
     * worse than the refusal it replaced: the user is told to ask questions of a
     * book the retriever cannot see. So when the pipeline believes it succeeded,
     * that belief is CHECKED against the index before it is written down.
     *
     * A missing counter is not treated as zero — an older wiring that cannot
     * count must not turn every success into a failure — but a counter that
     * answers zero is believed.
     */
    if ((terminal.state === 'ready' || terminal.state === 'ready_with_unplaced_pages')
        && this.deps.countIndexedChunks) {
      const chunks = await this.deps.countIndexedChunks(job.scope, job.fileName).catch(() => undefined);
      if (chunks === 0) {
        await this.deps.persist(job.scope, {
          fileName: job.fileName,
          state: 'ocr_failed',
          startedAt,
          failureReason:
            'the pages were read but nothing could be indexed from them, so this document is not searchable',
        });
        return;
      }
    }

    await this.deps.persist(job.scope, terminal);
  }
}

/**
 * The reader itself is missing, as opposed to the document being unreadable.
 *
 * One predicate, used by BOTH the state and the sentence, so the two can never
 * disagree about which kind of failure this was.
 */
export function isReaderUnavailable(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  // The binary name and ENOENT can appear in either order — Node reports
  // "spawn pdftoppm ENOENT" — so neither is assumed to come first.
  return /ENOENT/i.test(message) && /(pdftoppm|pdfinfo|tesseract)/i.test(message);
}

/** Map a thrown error onto the state the user should see. */
export function classifyFailure(error: unknown): DocumentReadiness['state'] {
  const failure = (error as { failure?: { kind?: string } })?.failure?.kind;
  if (failure === 'encrypted') return 'encrypted';
  if (failure === 'corrupt') return 'corrupt';
  if (failure === 'no_text_layer') return 'no_text_layer';
  /*
   * 🚨 CHECKED BEFORE ocr_failed, BECAUSE IT IS NOT AN OCR FAILURE.
   *
   * A missing pdftoppm/pdfinfo/tesseract means OCR never ran. Reporting that as
   * `ocr_failed` tells the user their scan defeated the recogniser and sends
   * them off to re-scan a perfectly good book, when the truthful answer is that
   * nothing on this server could have read it and they should do nothing.
   */
  if (isReaderUnavailable(error)) return 'reader_unavailable';
  return 'ocr_failed';
}

export function describeFailure(error: unknown): string {
  const message = String((error as { message?: string })?.message ?? error);
  /*
   * A missing binary is an operator problem, not the user's document. Saying
   * "this file could not be read" would send them to re-scan a perfectly good
   * book, so the two are worded differently.
   *
   * The binary name and ENOENT can appear in either order — Node reports
   * "spawn pdftoppm ENOENT" — so neither is assumed to come first.
   */
  const missingBinary = /ENOENT/i.test(message);
  if (missingBinary && /(pdftoppm|pdfinfo)/i.test(message)) return 'the page renderer is not available on this server';
  if (missingBinary && /tesseract/i.test(message)) return 'the text recogniser is not available on this server';
  // Anything else that reaches `isReaderUnavailable` still gets a sentence that
  // names the server rather than the file, so the state and the prose agree.
  return message.slice(0, 200);
}
