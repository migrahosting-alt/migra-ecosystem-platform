// The timeout hierarchy, written down so it can be checked instead of assumed.
//
// There are TWO clocks, measuring different things, and conflating them is what
// produced the defects this file exists to prevent.
//
// 1. PATIENCE FOR SILENCE — short, and RESET by any sign of life (a token, a
//    progress event, a keepalive). It answers "is anything still happening?".
//    Shortest at the UI, because a person should not stare at a dead surface:
//
//        UI idle  <  Brain idle  <  provider idle
//
// 2. HARD CEILINGS — long, absolute, never reset. They answer "how long may this
//    take at most?". Ordered the OTHER way, innermost smallest:
//
//        provider ceiling  <  Brain budget  <  UI budget
//
//    so the layer CLOSEST to the work is the one that expires first and names the
//    cause. When an outer layer fires first, every inner detail is lost and the
//    user is told something generic and usually wrong — a still-running local
//    generation reached the UI as HTTP 500 exactly this way.
//
// Both orderings are asserted by a test, so the numbers cannot drift apart.

export interface TimeoutHierarchy {
  /** Reset by any sign of life. */
  idle: { ui: number; brain: number; provider: number };
  /** Never reset. Innermost first. */
  ceiling: { provider: number; brain: number; ui: number };
  /** How often liveness is emitted while work is in progress. */
  keepaliveMs: number;
}

/**
 * The shipped hierarchy.
 *
 * The provider ceiling is the real limit on a single generation; the Brain adds
 * headroom to record the outcome, and the UI adds a little more so it never
 * pre-empts a Brain that is about to answer.
 */
export const DEFAULT_TIMEOUTS: TimeoutHierarchy = {
  idle: { ui: 120_000, brain: 120_000, provider: 120_000 },
  // 8 minutes is the real limit on one local generation; each outer layer adds a
  // minute of headroom to record and report. The chain is kept TIGHT on purpose:
  // the first draft put the UI ceiling below the provider's, which is the very
  // inversion this file exists to prevent, and made the whole chain incoherent.
  ceiling: { provider: 480_000, brain: 540_000, ui: 600_000 },
  keepaliveMs: 15_000,
};

export interface HierarchyViolation {
  rule: 'idle-order' | 'ceiling-order' | 'keepalive-too-slow';
  detail: string;
}

/**
 * Check a hierarchy. Returns every violation rather than the first, because a
 * mis-set chain usually breaks in more than one place.
 *
 * `ui` idle may EQUAL the inner ones — what must never happen is the UI being
 * more patient than the layer it is waiting on, which would hide a dead stream.
 */
export function checkHierarchy(h: TimeoutHierarchy): HierarchyViolation[] {
  const violations: HierarchyViolation[] = [];
  if (h.idle.ui > h.idle.brain || h.idle.brain > h.idle.provider) {
    violations.push({
      rule: 'idle-order',
      detail: `patience for silence must not grow inwards: ui ${h.idle.ui} <= brain ${h.idle.brain} <= provider ${h.idle.provider}`,
    });
  }
  // The WHOLE chain, not just the half that happened to hold. An earlier draft
  // checked only provider < brain while shipping a UI ceiling below both.
  if (!(h.ceiling.provider < h.ceiling.brain && h.ceiling.brain < h.ceiling.ui)) {
    violations.push({
      rule: 'ceiling-order',
      detail: `hard ceilings must grow outwards so the inner layer names the failure: provider ${h.ceiling.provider} < brain ${h.ceiling.brain} < ui ${h.ceiling.ui}`,
    });
  }
  // Keepalive must be comfortably inside the smallest patience, or a live stream
  // looks dead. A third is the margin: two missed frames still do not trip it.
  const smallestIdle = Math.min(h.idle.ui, h.idle.brain, h.idle.provider);
  if (h.keepaliveMs * 3 > smallestIdle) {
    violations.push({
      rule: 'keepalive-too-slow',
      detail: `keepalive ${h.keepaliveMs}ms must be at most a third of the smallest patience ${smallestIdle}ms`,
    });
  }
  return violations;
}
