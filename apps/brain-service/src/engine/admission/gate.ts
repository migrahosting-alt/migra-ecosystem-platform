/**
 * The single place a turn is admitted or refused.
 *
 * 🚨 WHY THIS IS ONE COMPONENT AND NOT A BLOCK COPIED INTO EACH ROUTE.
 *
 * The chat path gated on capacity for weeks. The coding agent — the product —
 * never did, because protecting it meant remembering to paste the same block into
 * a second route, and nobody did. That is not a discipline failure; it is a design
 * that required discipline where it could have required nothing. A third entry
 * point must be protected by construction, so there is exactly one `admit`.
 *
 * 🚨 AND WHY IT CACHES. The compute probe CONSUMES the resource it measures. Under
 * load against a contended card, a per-turn probe would send N more generations at
 * the GPU that is already the problem — monitoring becoming the outage. So:
 *
 *   - SINGLE-FLIGHT: concurrent callers share one in-flight probe.
 *   - TTL: a reading is reused briefly afterwards. GPU contention persists for
 *     minutes, so seconds of staleness cost nothing and bound the probe rate to
 *     roughly one per TTL no matter the request rate.
 *
 * FAIL-OPEN IS DELIBERATE AND NARROW. Unreadable signals ADMIT, because a
 * monitoring outage must never become a service outage. Only a positive reading of
 * `busy` or `unavailable` refuses.
 *
 * © MigraTeck LLC.
 */

import { applyComputeProbe, classify, shouldRefuse } from './policy.js';
import { nativeBase, probeCompute, readResidency } from './signals/inference.js';
import { readStudio } from './signals/studio.js';
import { recordAdmission } from './telemetry.js';
import { resolveThresholds, type AdmissionThresholds } from './thresholds.js';
import type { AdmissionDecision, CapacityReading } from './types.js';

export interface GateConfig {
  /** Ollama-compatible base; `/v1` suffix is tolerated and stripped. */
  providerBaseUrl?: string;
  /** ComfyUI base URL. Absent means "no studio configured", NOT "unreachable". */
  studioBaseUrl?: string;
  /**
   * Is there a real GPU behind this deployment?
   *
   * False for stub providers, where there is no card to be busy and probing a
   * machine that is not there would make the suite depend on a workstation being
   * awake. A disengaged gate ADMITS and says so (`not-applicable`).
   */
  enabled: boolean;
  thresholds?: Partial<AdmissionThresholds>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface AdmitRequest {
  /** The model this turn intends to use, when known. */
  model?: string;
}

interface CacheEntry {
  reading: CapacityReading;
  at: number;
}

/**
 * One gate per configuration. A class rather than module state so tests are
 * isolated from each other and a second deployment target cannot inherit the
 * first one's cached view of a different machine.
 */
export class AdmissionGate {
  private readonly thresholds: AdmissionThresholds;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private cache?: CacheEntry;
  private inFlight?: Promise<CapacityReading>;

  constructor(private readonly config: GateConfig) {
    this.thresholds = resolveThresholds(config.thresholds);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
  }

  async admit(request: AdmitRequest = {}): Promise<AdmissionDecision> {
    if (!this.config.enabled) {
      const decision: AdmissionDecision = {
        state: 'unknown', reason: 'not-applicable', signals: {},
        outcome: 'admitted', cached: false, ageMs: 0,
      };
      recordAdmission(decision);
      return decision;
    }

    const fresh = this.cached();
    if (fresh) {
      const decision = this.decide(fresh.reading, true, this.now() - fresh.at);
      recordAdmission(decision);
      return decision;
    }

    // Single-flight: whoever arrives while a probe is running waits for it rather
    // than starting another against the same card.
    this.inFlight ??= this.read(request).finally(() => {
      this.inFlight = undefined;
    });
    const reading = await this.inFlight;
    const decision = this.decide(reading, false, 0);
    recordAdmission(decision);
    return decision;
  }

  private cached(): CacheEntry | undefined {
    if (!this.cache) return undefined;
    return this.now() - this.cache.at < this.thresholds.cacheTtlMs ? this.cache : undefined;
  }

  /** Probe, classify, and cache. Never throws: a failure here reads as `unknown`. */
  private async read(request: AdmitRequest): Promise<CapacityReading> {
    let reading: CapacityReading;
    try {
      const base = nativeBase(this.config.providerBaseUrl);
      const studioBase = (this.config.studioBaseUrl ?? '').replace(/\/$/, '');
      const [residency, studio] = await Promise.all([
        base ? readResidency(base, this.thresholds.signalTimeoutMs, this.fetchImpl) : undefined,
        studioBase ? readStudio(studioBase, this.thresholds.signalTimeoutMs, this.fetchImpl) : undefined,
      ]);

      const step = classify({
        ...(residency ? { residency } : {}),
        ...(studio ? { studio } : {}),
        ...(request.model ? { model: request.model } : {}),
        thresholds: this.thresholds,
      });

      reading = step.kind === 'decided'
        ? step.reading
        : applyComputeProbe(
            step.signals,
            await probeCompute(nativeBase(this.config.providerBaseUrl), step.model, this.thresholds.computeTimeoutMs, this.fetchImpl),
          );
    } catch {
      // A bug in the gate must not become a chat outage.
      reading = { state: 'unknown', reason: 'signals-unreadable', signals: {} };
    }
    this.cache = { reading, at: this.now() };
    return reading;
  }

  private decide(reading: CapacityReading, cached: boolean, ageMs: number): AdmissionDecision {
    const refuse = shouldRefuse(reading);
    return {
      ...reading,
      outcome: refuse ? 'refused' : 'admitted',
      ...(refuse ? { code: reading.state === 'busy' ? 'GPU_BUSY' as const : 'ENGINE_UNAVAILABLE' as const } : {}),
      cached,
      ageMs,
    };
  }
}
