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
    await this.deps.persist(scope, {
      fileName,
      state: 'processing',
      stage: 'uploaded',
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
    const { map } = await processScannedPdf(job.pdfPath, job.fileName, {
      report: (readiness) => this.deps.persist(job.scope, readiness),
      ...(this.deps.now ? { now: this.deps.now } : {}),
    });

    if (this.deps.index) {
      await this.deps.persist(job.scope, {
        fileName: job.fileName, state: 'processing', stage: 'indexing', startedAt,
      });
      await this.deps.index(job.scope, job.fileName, map);
    }

    await this.deps.persist(job.scope, readinessFromMap(job.fileName, map, startedAt));
  }
}

/** Map a thrown error onto the state the user should see. */
export function classifyFailure(error: unknown): DocumentReadiness['state'] {
  const failure = (error as { failure?: { kind?: string } })?.failure?.kind;
  if (failure === 'encrypted') return 'encrypted';
  if (failure === 'corrupt') return 'corrupt';
  if (failure === 'no_text_layer') return 'no_text_layer';
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
  return message.slice(0, 200);
}
