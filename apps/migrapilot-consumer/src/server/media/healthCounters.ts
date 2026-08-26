import 'server-only'

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { StorageHealthEvent } from './dualReadMediaStorage'

/**
 * Media storage health, counted and written where something can READ it.
 *
 * WHY THIS EXISTS. These events were already emitted — and went to `console.info`
 * and nowhere else. A line in a log that no timer reads, no threshold compares
 * and no alert fires on is not monitoring; it is a record that would explain the
 * outage afterwards. The whole point of a fallback counter is to notice that
 * object storage is broken BEFORE every read has been quietly served by the
 * local copy for a fortnight.
 *
 * So the counters live here, and are written to a file a host check reads on a
 * timer. A file rather than an endpoint deliberately: the checker then needs no
 * credential, no network path and no route that must stay unauthenticated, and
 * it keeps working when the app is too sick to serve HTTP — which is exactly
 * when the numbers matter most.
 */

export type MediaHealthKind = StorageHealthEvent['kind']

const KINDS: readonly MediaHealthKind[] = [
  'fallback',
  'mismatch',
  'error',
  'write-failed',
  'delete-failed',
]

export interface MediaHealthSnapshot {
  /** Identifies this process, so a reader can tell a restart from a quiet period. */
  pid: number
  startedAt: number
  updatedAt: number
  counts: Record<MediaHealthKind, number>
  /** The most recent event of each kind, for a human reading the alert. */
  last: Partial<Record<MediaHealthKind, { key: string; detail?: string; at: number }>>
}

const started = Date.now()

function emptyCounts(): Record<MediaHealthKind, number> {
  return KINDS.reduce(
    (acc, kind) => ({ ...acc, [kind]: 0 }),
    {} as Record<MediaHealthKind, number>,
  )
}

let state: MediaHealthSnapshot = {
  pid: process.pid,
  startedAt: started,
  updatedAt: started,
  counts: emptyCounts(),
  last: {},
}

/*
 * A dedicated directory, because TWO separate things must both be true.
 *
 * Found by deploying it wrong twice. The path must be inside the unit's
 * `ReadWritePaths` — the service runs `ProtectSystem=strict`, so plain
 * `/var/lib/migrapilot` is read-only to it — AND it must be writable by the
 * `migrapilot` user, which ruled out `/var/log/migrapilot` (root:root 755,
 * where systemd itself opens the log files as root). The first attempt failed
 * the first condition, the second failed the second, and both failed silently
 * until this module started reporting its own write errors.
 *
 * `/var/lib/migrapilot/health` is owned by the service user and named in a
 * drop-in, so it satisfies both without widening the sandbox to the whole
 * state directory.
 */
const healthFile = (): string =>
  process.env.MIGRAPILOT_MEDIA_HEALTH_FILE ?? join('/var/lib/migrapilot/health', 'media-health.json')

/**
 * A fallback is chatty; a mismatch is not.
 *
 * Flushing on every read would put a synchronous write in the path of serving an
 * image, so the noisy kind is batched. The kinds that mean something is WRONG are
 * never batched — a mismatch that is still sitting in memory when the process
 * dies is the one event that most needed to survive.
 */
const FLUSH_INTERVAL_MS = 5_000
const URGENT: readonly MediaHealthKind[] = ['mismatch', 'error', 'write-failed', 'delete-failed']

let lastFlush = 0
let pending = false
let persistFailureReported = false

function flush(): void {
  try {
    const path = healthFile()
    mkdirSync(dirname(path), { recursive: true })
    // Written to a sibling and renamed, so a reader never sees half a file.
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 })
    renameSync(temporary, path)
    lastFlush = Date.now()
    pending = false
    persistFailureReported = false
  } catch (error) {
    /*
     * Monitoring must never break the thing it is monitoring, so this still
     * cannot throw — but it must not be SILENT either. A swallowed EROFS is
     * exactly how these counters spent their first deployment writing nowhere
     * while every check reported healthy. Reported once per outage, not per
     * event, so a broken path cannot itself become a flood.
     */
    if (!persistFailureReported) {
      persistFailureReported = true
      console.error(
        `migrapilot.media.health.persist_failed ${JSON.stringify({
          path: healthFile(),
          error: error instanceof Error ? error.message : String(error),
        })}`,
      )
    }
  }
}

/** Count one event, and persist it if it is the kind that cannot wait. */
export function recordMediaHealth(event: StorageHealthEvent): void {
  try {
    const kind = event.kind
    state = {
      ...state,
      updatedAt: Date.now(),
      counts: { ...state.counts, [kind]: (state.counts[kind] ?? 0) + 1 },
      last: {
        ...state.last,
        [kind]: {
          key: event.key,
          ...(event.detail ? { detail: event.detail } : {}),
          at: Date.now(),
        },
      },
    }
    pending = true
    if (URGENT.includes(kind) || Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush()
  } catch {
    // As above: never throw from telemetry.
  }
}

/** The counters as they stand. */
export function mediaHealthSnapshot(): MediaHealthSnapshot {
  return { ...state, counts: { ...state.counts }, last: { ...state.last } }
}

/** Write any batched events out. Called on shutdown and by tests. */
export function flushMediaHealth(): void {
  if (pending) flush()
}

/** Reset in-process state. Tests only. */
export function resetMediaHealth(): void {
  state = {
    pid: process.pid,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    counts: emptyCounts(),
    last: {},
  }
  lastFlush = 0
  pending = false
}
