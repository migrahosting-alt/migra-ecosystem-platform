/**
 * Every number admission control depends on, in one place, with its provenance.
 *
 * 🚨 A TUNABLE WITHOUT A MEASUREMENT IS A GUESS THAT LOOKS LIKE A DECISION. These
 * were baked into the middle of the classifier as bare literals, which meant an
 * operator facing a mis-tuned gate had to read the algorithm to find them, and
 * could not change one without a redeploy. Each is stated with the measurement it
 * came from, so a future change is an argument with evidence rather than taste.
 *
 * All are overridable by environment variable. Overrides are validated: a
 * malformed value is IGNORED and the default stands, because a typo in an env var
 * must not silently disable a safety gate.
 *
 * © MigraTeck LLC.
 */

const GB = 1024 * 1024 * 1024;

/** Read a positive-number override, or keep the default. Never throws. */
function numFromEnv(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface AdmissionThresholds {
  /** Budget for reading each metadata probe (`/api/ps`, `/queue`, `/system_stats`). */
  signalTimeoutMs: number;
  /** Deadline for the one-token compute probe. */
  computeTimeoutMs: number;
  /** Below this much free VRAM, a cold model load is not worth starting. */
  coldLoadHeadroomBytes: number;
  /** How long a reading may be reused before it is probed again. */
  cacheTtlMs: number;
}

/**
 * Defaults, each with the measurement behind it:
 *
 * - `signalTimeoutMs` 2 500 — these endpoints answer in milliseconds when healthy;
 *   this gates a user-facing turn, so the budget is deliberately small.
 *
 * - `computeTimeoutMs` 20 000 — RAISED FROM 6 000 ON MEASUREMENT, not on taste.
 *
 *   The original 6 s came from two numbers: warm answers at 0.29-0.40 s, and a card
 *   held by a render not answering in 180 s. Those do separate cleanly, and 6 s sat
 *   between them. What that reasoning missed is a THIRD state.
 *
 *   Ollama unloads an idle model, so the first request after a pause pays a cold
 *   load: measured 5.08 s, 11.8 s, and 55 s immediately after a machine restart. A
 *   6 s deadline sits INSIDE that range, so the gate refused turns the card would
 *   have served — the user's first message after a coffee break, told the GPU was
 *   busy when it was merely loading.
 *
 *   20 s clears the common cold load with margin and is still 12x faster than the
 *   240 s provider deadline this exists to prevent. A genuinely contended card now
 *   costs at most 20 s before an honest refusal, which is the right trade: waiting
 *   20 s and getting an answer beats being refused in 6 s and retrying.
 *
 * - `coldLoadHeadroomBytes` 14 GB — sized from the measured vision model at 13.5 GB
 *   resident. Applies only when the model is NOT already loaded.
 *
 * - `cacheTtlMs` 3 000 — GPU contention persists for minutes, not milliseconds, so a
 *   few seconds of staleness costs nothing. It matters because the compute probe
 *   CONSUMES the resource it measures: without this, ten concurrent turns against a
 *   contended card issue ten more generations at it.
 */
export const DEFAULT_THRESHOLDS: AdmissionThresholds = {
  signalTimeoutMs: 2_500,
  computeTimeoutMs: 20_000,
  coldLoadHeadroomBytes: 14 * GB,
  cacheTtlMs: 3_000,
};

export function resolveThresholds(
  overrides: Partial<AdmissionThresholds> = {},
  env: NodeJS.ProcessEnv = process.env,
): AdmissionThresholds {
  return {
    signalTimeoutMs:
      overrides.signalTimeoutMs ?? numFromEnv('MIGRAPILOT_ADMISSION_SIGNAL_TIMEOUT_MS', DEFAULT_THRESHOLDS.signalTimeoutMs, env),
    computeTimeoutMs:
      overrides.computeTimeoutMs ?? numFromEnv('MIGRAPILOT_ADMISSION_COMPUTE_TIMEOUT_MS', DEFAULT_THRESHOLDS.computeTimeoutMs, env),
    coldLoadHeadroomBytes:
      overrides.coldLoadHeadroomBytes ?? numFromEnv('MIGRAPILOT_ADMISSION_COLD_LOAD_HEADROOM_BYTES', DEFAULT_THRESHOLDS.coldLoadHeadroomBytes, env),
    cacheTtlMs:
      overrides.cacheTtlMs ?? numFromEnv('MIGRAPILOT_ADMISSION_CACHE_TTL_MS', DEFAULT_THRESHOLDS.cacheTtlMs, env),
  };
}
