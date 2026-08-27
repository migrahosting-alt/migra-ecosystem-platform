/**
 * What to do with jobs that were running when the process died.
 *
 * A restart leaves `processing` rows nothing is working on. Left alone they say
 * "Reading…" forever — a lie that costs the user more than an error, because an
 * error tells them to act and a spinner tells them to wait.
 *
 * Resuming is safe for this pipeline only because it is IDEMPOTENT: rasterising
 * and OCR-ing the same PDF again produces the same pages, and reconstruction is
 * a pure function of those pages. Nothing is appended, so a second run replaces
 * rather than doubles.
 */

import type { DocumentReadiness, ProcessingStage } from './documentReadiness.js';

/** How long a `processing` row may go unwritten before it is presumed dead. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export type RecoveryAction =
  /** Still being worked on by a live job — leave it alone. */
  | { kind: 'leave'; reason: string }
  /** Nothing is working on it and it can safely start over. */
  | { kind: 'resume'; from: ProcessingStage; reason: string }
  /** Cannot be resumed; record a truthful failure instead of a spinner. */
  | { kind: 'fail'; readiness: DocumentReadiness; reason: string };

export interface RecoveryContext {
  now: number;
  /** Files still present in the library. A deleted file cannot be resumed. */
  existingFiles: ReadonlySet<string>;
  /** Documents a live job in THIS process is already handling. */
  activeJobs?: ReadonlySet<string>;
}

/**
 * Decide what a single interrupted record deserves.
 *
 * Deliberately a pure function: recovery decisions are the kind that get made
 * once at boot, are hard to observe, and are easy to get quietly wrong — so they
 * are tested directly rather than inferred from whatever the service did on
 * startup.
 */
export function decideRecovery(
  readiness: DocumentReadiness,
  context: RecoveryContext,
): RecoveryAction {
  if (readiness.state !== 'processing') {
    return { kind: 'leave', reason: 'not an interrupted job' };
  }

  if (context.activeJobs?.has(readiness.fileName)) {
    return { kind: 'leave', reason: 'a live job in this process owns it' };
  }

  /*
   * The file is gone. Resuming would rasterise a document that no longer exists,
   * and leaving it processing would leave a status for a file the user cannot
   * see. Neither is honest, so the record is closed.
   */
  if (!context.existingFiles.has(readiness.fileName)) {
    return {
      kind: 'fail',
      reason: 'the file was deleted while it was being read',
      readiness: {
        ...readiness,
        state: 'ocr_failed',
        failureReason: 'the file was removed before reading finished',
      },
    };
  }

  const idle = context.now - (readiness.updatedAt ?? readiness.startedAt ?? 0);
  if (idle < STALE_AFTER_MS) {
    /*
     * Recent enough that another process may still be working on it. Claiming it
     * here would run two jobs over one document and race on its readiness row.
     */
    return { kind: 'leave', reason: `last written ${Math.round(idle / 1000)}s ago; may still be live` };
  }

  return {
    kind: 'resume',
    from: 'rendering_pages',
    reason: `stale for ${Math.round(idle / 60000)} minutes; restarting from the beginning`,
  };
}

/**
 * A restart that happens repeatedly must not retry forever.
 *
 * Without this a PDF that reliably kills the process becomes a boot loop: start,
 * crash, resume, crash. After a few attempts the honest answer is that this
 * document cannot be read here.
 */
export const MAX_RESUME_ATTEMPTS = 3;

export function exhaustedReadiness(readiness: DocumentReadiness, attempts: number): DocumentReadiness {
  return {
    ...readiness,
    state: 'ocr_failed',
    failureReason:
      `reading was interrupted ${attempts} times; this document could not be processed here`,
  };
}
