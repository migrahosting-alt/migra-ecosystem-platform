/**
 * MEASURE DURING, NOT AFTER.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT THIS FIXES
 *
 * The 2026-09-13 candidate audit sampled `/api/ps` once, AFTER each generation
 * finished. By then a model may already have unloaded, so:
 *
 *   · `qwen3:8b` reported 0 bytes on three of five items and 11.5 GB on two —
 *     not because its footprint varied, but because the sampler arrived after
 *     the model had gone;
 *   · "peak VRAM" was never measured at all. What was recorded was
 *     "VRAM at one arbitrary moment after the work stopped", which is a
 *     different quantity wearing the same name.
 *
 * Capacity is one of the decisions this evidence is meant to inform, and a
 * number that is sometimes the peak and sometimes zero cannot inform it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT RECORDS
 *
 * Peak and minimum are the operator-grade facts: peak decides whether the model
 * FITS, and minimum free decides whether anything else can run beside it.
 * Residency transitions are kept because a model that loads and unloads between
 * turns is a latency problem that a single footprint number hides entirely —
 * that is exactly what `qwen3:8b`'s 247 s / 190 s / 7 s spread turned out to be.
 */

export interface VramSample {
  atMs: number;
  /** Bytes resident for the model under test. 0 means it is not loaded. */
  modelBytes: number;
  /** Every model resident at that instant, including other workloads. */
  totalBytes: number;
  residentModels: number;
}

export interface VramProfile {
  samples: number;
  /** The measurement this exists for. */
  peakModelBytes: number;
  peakTotalBytes: number;
  /** Lowest non-zero residency while the model was loaded. */
  minModelBytesWhileResident: number | null;
  /** Fraction of samples in which the model was resident at all. */
  residencyRatio: number;
  /** 🚨 Load/unload churn during a single run — invisible to a single sample. */
  transitions: number;
  /** True when another model shared the device at any point. */
  sharedDevice: boolean;
  maxOtherModels: number;
}

export function profile(samples: readonly VramSample[]): VramProfile {
  if (samples.length === 0) {
    return {
      samples: 0, peakModelBytes: 0, peakTotalBytes: 0, minModelBytesWhileResident: null,
      residencyRatio: 0, transitions: 0, sharedDevice: false, maxOtherModels: 0,
    };
  }
  let peakModel = 0, peakTotal = 0, resident = 0, transitions = 0, maxOther = 0;
  let minResident: number | null = null;
  let wasResident: boolean | null = null;

  for (const s of samples) {
    peakModel = Math.max(peakModel, s.modelBytes);
    peakTotal = Math.max(peakTotal, s.totalBytes);
    const isResident = s.modelBytes > 0;
    if (isResident) {
      resident += 1;
      minResident = minResident === null ? s.modelBytes : Math.min(minResident, s.modelBytes);
    }
    if (wasResident !== null && wasResident !== isResident) transitions += 1;
    wasResident = isResident;
    const others = Math.max(0, s.residentModels - (isResident ? 1 : 0));
    maxOther = Math.max(maxOther, others);
  }

  return {
    samples: samples.length,
    peakModelBytes: peakModel,
    peakTotalBytes: peakTotal,
    minModelBytesWhileResident: minResident,
    residencyRatio: resident / samples.length,
    transitions,
    sharedDevice: maxOther > 0,
    maxOtherModels: maxOther,
  };
}

/**
 * Sample a source on an interval until `stop()` is called.
 *
 * 🚨 A FAILED SAMPLE IS DROPPED, NEVER RECORDED AS ZERO. One unreachable poll
 * during a 200-second generation would otherwise become "the model was
 * unloaded", inventing a transition that never happened and dragging the
 * residency ratio down. Missing evidence must look missing.
 */
export function startSampling(
  read: () => Promise<VramSample | null>,
  intervalMs = 1000,
  now: () => number = Date.now,
): { stop: () => VramSample[] } {
  const samples: VramSample[] = [];
  let running = true;

  const tick = async (): Promise<void> => {
    while (running) {
      const started = now();
      try {
        const s = await read();
        if (s) samples.push(s);
      } catch {
        // Dropped on purpose. See above.
      }
      const elapsed = now() - started;
      await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - elapsed)));
    }
  };
  void tick();

  return {
    stop: () => {
      running = false;
      return samples;
    },
  };
}

export const GB = 1_000_000_000;
export const gb = (bytes: number): string => `${(bytes / GB).toFixed(1)} GB`;
