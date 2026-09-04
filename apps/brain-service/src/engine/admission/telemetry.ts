/**
 * What admission control did, in numbers an operator can read.
 *
 * Without this, "the gate is refusing everything" and "the gate never fires" look
 * identical from outside. Counters are keyed by REASON, not by state, because the
 * useful operational question is not "how many were busy" but "busy because a
 * render holds the card, or because the card would not answer".
 *
 * Deliberately in-process and unbounded-free: a fixed set of reason keys, no
 * per-model or per-user dimensions, so this can never grow without bound.
 *
 * © MigraTeck LLC.
 */

import type { AdmissionDecision, AdmissionReason } from './types.js';

export interface AdmissionCounters {
  admitted: number;
  refused: number;
  cacheHits: number;
  byReason: Record<string, number>;
  /** Compute-probe latencies, so a rising trend is visible before it becomes a refusal. */
  computeProbe: { count: number; totalMs: number; slowest: number };
  /** The most recent decision, for /health. Never a user prompt — signals only. */
  last?: { at: string; state: string; reason: AdmissionReason; outcome: string };
}

function empty(): AdmissionCounters {
  return { admitted: 0, refused: 0, cacheHits: 0, byReason: {}, computeProbe: { count: 0, totalMs: 0, slowest: 0 } };
}

let counters = empty();

export function recordAdmission(decision: AdmissionDecision, now: () => Date = () => new Date()): void {
  if (decision.outcome === 'admitted') counters.admitted += 1;
  else counters.refused += 1;
  if (decision.cached) counters.cacheHits += 1;
  counters.byReason[decision.reason] = (counters.byReason[decision.reason] ?? 0) + 1;
  const ms = decision.signals.computeProbeMs;
  if (typeof ms === 'number') {
    counters.computeProbe.count += 1;
    counters.computeProbe.totalMs += ms;
    counters.computeProbe.slowest = Math.max(counters.computeProbe.slowest, ms);
  }
  counters.last = {
    at: now().toISOString(),
    state: decision.state,
    reason: decision.reason,
    outcome: decision.outcome,
  };
}

/** A snapshot safe to serialise into /health. */
export function admissionCounters(): AdmissionCounters & { computeProbeAvgMs?: number } {
  const { count, totalMs } = counters.computeProbe;
  return {
    ...counters,
    byReason: { ...counters.byReason },
    computeProbe: { ...counters.computeProbe },
    ...(count > 0 ? { computeProbeAvgMs: Math.round(totalMs / count) } : {}),
  };
}

/** Tests only — process-wide state must be resettable or suites contaminate each other. */
export function resetAdmissionCounters(): void {
  counters = empty();
}
