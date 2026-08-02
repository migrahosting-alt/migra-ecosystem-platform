// MigraPilot — bounded polling for a governed coding run.
//
// Progress is read from the DURABLE record, never inferred from elapsed time. A
// model stage that takes ninety seconds is not progress and is not a stall; only
// the Brain's phase and child records say what happened, so this poller reports
// exactly those and nothing it computed itself.
//
// Three properties matter and are enforced here rather than left to callers:
//
//   NO OVERLAPPING REQUESTS. One request is in flight at a time. Overlapping polls
//   against a run whose revision is advancing produce out-of-order snapshots, and
//   a UI that renders an older revision after a newer one shows the user a state
//   the run has already left.
//
//   RENDER ON REVISION CHANGE. The revision is the Brain's own change counter, so
//   it is the honest trigger. Re-rendering on every tick would repaint an
//   unchanged approval panel underneath someone reading it.
//
//   BACKOFF WHILE NOTHING CHANGES. Long model stages produce no revisions; polling
//   them at a fixed fast interval is pure load. The interval grows while the
//   revision is static and resets the moment it moves.

import type { CodingResult, CodingRunClient, CodingRunSnapshot } from './codingRunClient.js';
import { isTerminalPhase, needsApproval } from './codingRunClient.js';

export type PollStopReason =
  | 'terminal'
  | 'awaiting_approval'
  | 'disposed'
  | 'corrupt'
  | 'not_found'
  | 'deadline'
  | 'transport_failure';

export interface PollOutcome {
  reason: PollStopReason;
  snapshot?: CodingRunSnapshot;
  detail?: string;
}

export interface PollOptions {
  runId: string;
  /** Fired only when the durable revision actually changed. */
  onSnapshot: (snapshot: CodingRunSnapshot) => void;
  /** Stop polling when the surface goes away. */
  isDisposed?: () => boolean;
  signal?: AbortSignal;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  /** Upper bound on total wall time. A run that outlives it is NOT declared
   * finished — the outcome says `deadline`, and the durable record still holds
   * the truth. */
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Consecutive transport failures tolerated before giving up. A dropped packet
   * is not a failed run. */
  maxTransientFailures?: number;
}

const DEFAULTS = {
  minIntervalMs: 400,
  maxIntervalMs: 4_000,
  deadlineMs: 30 * 60_000,
  maxTransientFailures: 5,
};

/**
 * Poll until the run needs the operator, finishes, or the surface goes away.
 *
 * Returns rather than throws: every stop has a named reason, because "polling
 * ended" is not the same fact as "the run ended" and a caller must be able to
 * tell them apart.
 */
export async function pollCodingRun(client: CodingRunClient, options: PollOptions): Promise<PollOutcome> {
  const min = options.minIntervalMs ?? DEFAULTS.minIntervalMs;
  const max = options.maxIntervalMs ?? DEFAULTS.maxIntervalMs;
  const deadline = options.deadlineMs ?? DEFAULTS.deadlineMs;
  const maxFailures = options.maxTransientFailures ?? DEFAULTS.maxTransientFailures;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  const startedAt = now();
  let interval = min;
  let lastRevision = -1;
  let consecutiveFailures = 0;
  let latest: CodingRunSnapshot | undefined;

  for (;;) {
    if (options.isDisposed?.()) return { reason: 'disposed', ...(latest ? { snapshot: latest } : {}) };
    if (options.signal?.aborted) return { reason: 'disposed', ...(latest ? { snapshot: latest } : {}) };
    if (now() - startedAt > deadline) {
      return { reason: 'deadline', ...(latest ? { snapshot: latest } : {}), detail: `Polling stopped after ${deadline}ms; the run is still recorded as ${latest?.phase ?? 'unknown'}.` };
    }

    // Awaited, so a slow response cannot overlap the next tick.
    const result: CodingResult<CodingRunSnapshot> = await client.getCodingRun(options.runId, options.signal);

    if (result.kind === 'ok') {
      consecutiveFailures = 0;
      const snapshot = result.value;
      latest = snapshot;
      if (snapshot.revision !== lastRevision) {
        lastRevision = snapshot.revision;
        interval = min; // Something happened — look again promptly.
        options.onSnapshot(snapshot);
      } else {
        interval = Math.min(max, Math.round(interval * 1.6));
      }
      if (isTerminalPhase(snapshot)) return { reason: 'terminal', snapshot };
      if (needsApproval(snapshot)) return { reason: 'awaiting_approval', snapshot };
    } else if (result.kind === 'corrupt') {
      // Never retried: a record that cannot be interpreted will not become
      // interpretable by asking again.
      return { reason: 'corrupt', ...(latest ? { snapshot: latest } : {}), detail: result.corruption.detail };
    } else if (result.kind === 'not_found') {
      return { reason: 'not_found', detail: 'The Brain no longer has a record of this run.' };
    } else if (result.kind === 'cancelled') {
      return { reason: 'disposed', ...(latest ? { snapshot: latest } : {}) };
    } else if (result.kind === 'timeout' || result.kind === 'transport_failure') {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxFailures) {
        return { reason: 'transport_failure', ...(latest ? { snapshot: latest } : {}), detail: `${consecutiveFailures} consecutive transport failures.` };
      }
      interval = Math.min(max, Math.round(interval * 2));
    } else {
      return { reason: 'transport_failure', ...(latest ? { snapshot: latest } : {}), detail: `Unexpected response: ${result.kind}` };
    }

    await sleep(interval);
  }
}
