/**
 * What the anonymous quota routes need from the engine, as an injected seam.
 *
 * `store()` is a FUNCTION rather than a value because durable persistence can be
 * unavailable at boot and become available later — and because a route holding a
 * captured `undefined` would keep answering 503 long after the database came
 * back. Reading it per request is the difference between "degraded now" and
 * "degraded until someone restarts it".
 *
 * Clock and id generation are injected so tests assert real values instead of
 * asserting that time passed.
 */

import type { PostgresDurableStore } from './persistence/postgresStore.js';

/** Namespace prefix, shared with the consumer's `anonymousIdentity.ts`. */
export const ANON_PREFIX = 'anon:';

export interface AnonymousQuotaDeps {
  /** Undefined when durable persistence is unavailable — never a silent fake. */
  store: () => PostgresDurableStore | undefined;
  /** Turns a signed-out visitor may take before signing in. */
  turnLimit: () => number;
  /**
   * How long a reservation stays held before it can be reclaimed.
   *
   * A visitor who closes the tab mid-stream never settles, and without an expiry
   * that turn would be charged forever. Long enough to outlast a slow answer,
   * short enough that a dead turn comes back the same session.
   */
  holdMs: () => number;
  now: () => number;
  newId: () => string;
}

export const DEFAULT_ANON_TURN_LIMIT = 5;
export const DEFAULT_ANON_HOLD_MS = 5 * 60_000;

/** Read the bounds from the environment, refusing values that are not numbers. */
export function anonymousLimitsFromEnv(env: NodeJS.ProcessEnv): { turnLimit: number; holdMs: number } {
  const num = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    // A typo'd limit must not silently become 0 (no anonymous chat at all) or
    // NaN (every comparison false, so unlimited chat).
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    turnLimit: num(env.MIGRAPILOT_ANON_TURN_LIMIT, DEFAULT_ANON_TURN_LIMIT),
    holdMs: num(env.MIGRAPILOT_ANON_HOLD_MS, DEFAULT_ANON_HOLD_MS),
  };
}
