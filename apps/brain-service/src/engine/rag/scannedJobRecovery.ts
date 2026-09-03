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

/**
 * How long a row may go UNWRITTEN before it is presumed dead.
 *
 * 🚨 REDUCED FROM 15 MINUTES, WHICH WAS A LIE WITH A LONG TAIL. After a Brain
 * restart the UI kept reporting "Reading text — page 10 of 24" for work that had
 * already stopped: a specific, advancing-looking number describing a process
 * that no longer existed. Fifteen minutes of that is worse than an honest
 * failure, because the user waits on it.
 *
 * MEASURED FROM THE LAST WRITE, NOT FROM THE START. Every stage transition
 * upserts `updated_at`, and the scanned job writes BEFORE each page — a
 * heartbeat every 15–24 seconds at the measured OCR rate. Two minutes therefore
 * allows five to eight missed heartbeats before anything is presumed dead.
 *
 * WHY IT IS SAFE TO BE THIS AGGRESSIVE. The clock is NOT what protects a running
 * job: `activeJobs` is. A job owned by this process is returned as `leave`
 * before the idle check is ever reached, whatever the stage and however long it
 * has been quiet — which matters for `indexing`, the one stage that is a single
 * long operation rather than a per-page loop. The threshold governs only rows
 * whose owning process is GONE, and for those a shorter window is strictly more
 * truthful. A different process holding the same row is not the deployment model
 * here; there is one Brain.
 */
export const STALE_AFTER_MS = 2 * 60 * 1000;

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
  /*
   * 🚨 `queued` IS INTERRUPTED TOO, AND MORE CERTAINLY THAN `processing`.
   *
   * The queue is in-memory and lost on restart, so a document that was waiting
   * its turn when the process died is not waiting for anything — nothing holds a
   * reference to it any more. Covering only `processing` left those rows saying
   * "Waiting to start" for ever, which is the same never-ending status this
   * recovery exists to clear, reached through the state added to make queueing
   * honest.
   */
  if (readiness.state !== 'processing' && readiness.state !== 'queued') {
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
