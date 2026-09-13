/**
 * FITTING IN VRAM IS NOT THE SAME AS FITTING IN THE DEPLOYMENT.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE FINDING THIS EXISTS FOR
 *
 * `qwen3:14b` measured beautifully on an idle card: 15.9 GB peak, ZERO
 * load/unload transitions, 100% residency, warm median 9 s. On that evidence it
 * looked like the candidate.
 *
 * Run again with the normal workstation floor beside it — one concurrent
 * `qwen3:8b` — and the quality scores were IDENTICAL while the operational
 * behaviour collapsed:
 *
 *     transitions   0   ->  55     (across 54 items: evicted roughly per item)
 *     residency   100%  ->  44%
 *     warm median   9 s ->  18 s
 *
 * The cause is arithmetic and is not tunable:
 *
 *     device                 24576 MiB
 *     qwen3:14b  peak       ~15163 MiB
 *     qwen3:8b   peak       ~10967 MiB
 *     both resident         ~26131 MiB   -> over the card by ~1555 MiB
 *
 * Two models that each fit cannot both be resident, so the runtime evicts one
 * to load the other, continuously.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE RULE
 *
 * Owner ruling, 2026-09-13:
 *
 *   "Qualification must include deployment-envelope compatibility, not just
 *    per-model fit. A model that individually fits in VRAM but cannot coexist
 *    with the normal resident workload is NOT QUALIFIED FOR THAT DEPLOYMENT
 *    TARGET."
 *
 * A qualification is therefore always a claim about a model AND a target, never
 * about a model alone — which is the same shape as every other lesson this
 * programme has learned: a provider label is not a locality guarantee, a
 * release name is not a source revision, and now a VRAM figure is not a
 * deployment envelope.
 *
 * And the fix that must NOT be used: evicting the rest of the product whenever
 * someone selects the deep family. That does not remove the instability, it
 * moves it onto everything else and lets one capability monopolise the device.
 */

export interface ResidentWorkload {
  /** What it is, for a human reading a refusal. */
  model: string;
  /** Measured peak, not advertised size. */
  peakBytes: number;
  /** False for a workload that may be evicted without harming a product promise. */
  mustRemainResident: boolean;
}

export interface DeploymentEnvelope {
  target: string;
  deviceTotalBytes: number;
  /** What normally lives on this device. */
  baseline: readonly ResidentWorkload[];
  /**
   * Headroom that must survive beyond every resident model.
   *
   * Not padding: a runtime needs working space for KV cache growth, and a
   * device at exactly 100% is one long context away from an eviction.
   */
  requiredHeadroomBytes: number;
}

export type EnvelopeFailure =
  /** The candidate alone exceeds the device. */
  | 'exceeds_device'
  /** It fits alone, and not beside the workloads that must stay. */
  | 'cannot_coexist'
  /** Everything fits, with too little room left to work in. */
  | 'insufficient_headroom'
  /** Measured churn proves it did not coexist, whatever the arithmetic said. */
  | 'observed_eviction';

export interface EnvelopeVerdict {
  fits: boolean;
  failure: EnvelopeFailure | null;
  candidateBytes: number;
  pinnedBaselineBytes: number;
  /** Negative means the combination is over the device. */
  headroomBytes: number;
  detail: string;
}

const gb = (b: number): string => `${(b / 1_000_000_000).toFixed(1)} GB`;

/**
 * Would this candidate live here?
 *
 * 🚨 ONLY `mustRemainResident` WORKLOADS COUNT AGAINST IT. A baseline entry
 * that may be evicted is not a constraint — otherwise every incidental model
 * ever loaded would disqualify everything. The judgement about which workloads
 * are load-bearing is a product decision and belongs in the envelope, not here.
 */
export function checkEnvelope(
  candidateBytes: number,
  envelope: DeploymentEnvelope,
  observed?: { residencyRatio: number; transitions: number; items: number },
): EnvelopeVerdict {
  const pinned = envelope.baseline.filter((w) => w.mustRemainResident);
  const pinnedBytes = pinned.reduce((a, w) => a + w.peakBytes, 0);
  const headroom = envelope.deviceTotalBytes - candidateBytes - pinnedBytes;
  const base = {
    candidateBytes, pinnedBaselineBytes: pinnedBytes, headroomBytes: headroom,
  };

  if (candidateBytes > envelope.deviceTotalBytes) {
    return {
      ...base, fits: false, failure: 'exceeds_device',
      detail: `${gb(candidateBytes)} does not fit on ${envelope.target}'s ${gb(envelope.deviceTotalBytes)} device at all.`,
    };
  }
  if (headroom < 0) {
    return {
      ...base, fits: false, failure: 'cannot_coexist',
      detail:
        `${gb(candidateBytes)} fits alone but not beside ${pinned.map((w) => w.model).join(', ')} ` +
        `(${gb(pinnedBytes)}) on a ${gb(envelope.deviceTotalBytes)} device — over by ${gb(-headroom)}. ` +
        `The runtime will evict one to load the other.`,
    };
  }
  if (headroom < envelope.requiredHeadroomBytes) {
    return {
      ...base, fits: false, failure: 'insufficient_headroom',
      detail:
        `everything fits with only ${gb(headroom)} left, below the ${gb(envelope.requiredHeadroomBytes)} ` +
        `this target requires to work in.`,
    };
  }

  /*
   * 🚨 MEASUREMENT OVERRULES ARITHMETIC.
   *
   * The sums can say it fits while the device says otherwise — fragmentation,
   * another workload nobody declared, a runtime that preloads. Observed churn
   * is the stronger evidence and is allowed to fail a candidate the arithmetic
   * approved. Never the reverse: arithmetic may not rescue a candidate that was
   * measured thrashing.
   */
  if (observed && observed.items > 0) {
    const perItem = observed.transitions / observed.items;
    if (observed.residencyRatio < 0.9 || perItem >= 1) {
      return {
        ...base, fits: false, failure: 'observed_eviction',
        detail:
          `the arithmetic allows it, but it was MEASURED being evicted — residency ` +
          `${(observed.residencyRatio * 100).toFixed(0)}% and ${observed.transitions} load/unload ` +
          `transitions across ${observed.items} items. Measurement overrules the sums.`,
      };
    }
  }

  return {
    ...base, fits: true, failure: null,
    detail: `fits on ${envelope.target} with ${gb(headroom)} to spare beside ${pinned.length} pinned workload(s).`,
  };
}

/**
 * The workstation as it actually is on 2026-09-13.
 *
 * The 8B is pinned because it is the normal resident model for ordinary chat —
 * evicting it whenever someone picks the deep family would move the instability
 * onto every other product rather than remove it.
 */
export const WORKSTATION_24GB: DeploymentEnvelope = {
  target: 'workstation RTX 3090 24GB (shared)',
  deviceTotalBytes: 24_576 * 1_048_576,
  baseline: [
    { model: 'qwen3:8b', peakBytes: 11_500_000_000, mustRemainResident: true },
  ],
  // Room to work in, not padding.
  requiredHeadroomBytes: 2_000_000_000,
};
