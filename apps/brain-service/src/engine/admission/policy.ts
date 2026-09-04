/**
 * The decision. PURE — no network, no clock, no environment.
 *
 * Separated from the probes so every branch can be exercised exhaustively as data,
 * and so a new signal cannot quietly change what a state MEANS. The one place the
 * policy needs work done for it — asking the card for a token — is expressed as a
 * REQUEST the caller fulfils, rather than a callback the policy invokes. That keeps
 * this file free of I/O while still letting it drive the sequence.
 *
 * READ THE LADDER TOP TO BOTTOM: outage, then what is loaded, then what is
 * competing, then whether there is room to load.
 *
 * © MigraTeck LLC.
 */

import { BUSY_MESSAGE, UNAVAILABLE_MESSAGE, UNRESPONSIVE_MESSAGE } from './messages.js';
import { isModelResident, type ComputeReading, type ResidencyReading } from './signals/inference.js';
import type { StudioReading } from './signals/studio.js';
import type { AdmissionThresholds } from './thresholds.js';
import type { CapacityReading, CapacitySignals } from './types.js';

export interface PolicyInput {
  /** Absent when this deployment has no inference base configured. */
  residency?: ResidencyReading;
  /** Absent when no studio URL is configured — NOT the same as unreachable. */
  studio?: StudioReading;
  model?: string;
  thresholds: AdmissionThresholds;
}

/** Either the policy is done, or it needs one token from the card to finish. */
export type PolicyStep =
  | { kind: 'decided'; reading: CapacityReading }
  | { kind: 'needs-compute-probe'; model: string; signals: CapacitySignals };

function signalsFrom(input: PolicyInput): CapacitySignals {
  const unreachable: string[] = [];
  if (input.residency && !input.residency.reachable) unreachable.push('inference');
  if (input.studio && !input.studio.reachable) unreachable.push('studio');
  return {
    ...(input.studio?.reachable
      ? { comfyRunning: input.studio.running ?? 0, comfyPending: input.studio.pending ?? 0 }
      : {}),
    ...(input.studio?.vramFreeBytes !== undefined ? { vramFreeBytes: input.studio.vramFreeBytes } : {}),
    ...(input.studio?.vramTotalBytes !== undefined ? { vramTotalBytes: input.studio.vramTotalBytes } : {}),
    ...(input.residency?.reachable ? { residentModels: input.residency.residentModels } : {}),
    ...(input.residency?.residentVramBytes !== undefined
      ? { residentVramBytes: input.residency.residentVramBytes }
      : {}),
    ...(input.model && input.residency?.reachable
      ? { modelResident: isModelResident(input.residency.residentModels, input.model) }
      : {}),
    ...(unreachable.length ? { unreachable } : {}),
  };
}

export function classify(input: PolicyInput): PolicyStep {
  const signals = signalsFrom(input);
  const decided = (reading: CapacityReading): PolicyStep => ({ kind: 'decided', reading });

  // An inference server that is not answering is an OUTAGE, not contention. Saying
  // "busy" would send the user back to retry a thing that cannot work yet.
  if (input.residency && !input.residency.reachable) {
    return decided({ state: 'unavailable', reason: 'inference-unreachable', message: UNAVAILABLE_MESSAGE, signals });
  }

  // Nothing readable at all: admit, protected by the caller's own bounded deadline.
  if (!input.residency?.reachable && !input.studio?.reachable) {
    return decided({ state: 'unknown', reason: 'signals-unreadable', signals });
  }

  /*
   * 🚨 RESIDENCY IS NOT AVAILABILITY — MEASURED, NOT ASSUMED.
   *
   * This used to return `ready` the moment the model was loaded, reasoning that "a
   * ComfyUI job running beside an already-loaded model is contention, not a
   * blockade". OBSERVED 2026-09-03, disproving it: qwen2.5-coder:14b was resident
   * (15.3 GB) while a render held the card at 100% util, and a completion did not
   * return in 0.29 s — it did not return in 180 s, from the Brain's host AND from
   * the workstation itself. Every production turn spent 240 s reaching a generic
   * failure while /health reported `ready` throughout.
   *
   * Residency rules out a COLD LOAD. It says nothing about spare compute, and
   * compute is what a render takes. So the fast path is kept exactly where it was
   * earned — nothing competing — and where something IS competing the question is
   * settled by asking for a token.
   */
  if (signals.modelResident) {
    const contentionPossible = (signals.comfyRunning ?? 0) > 0 || (signals.unreachable ?? []).includes('studio');
    if (!contentionPossible) {
      return decided({ state: 'ready', reason: 'resident-idle', signals });
    }
    return { kind: 'needs-compute-probe', model: input.model!, signals };
  }

  // A render owns the card, and this turn would need a cold load behind it.
  if ((signals.comfyRunning ?? 0) > 0) {
    return decided({ state: 'busy', reason: 'render-holds-card', message: BUSY_MESSAGE, signals });
  }

  // Not resident, and possibly not enough headroom to bring it in. The estimate is
  // the more pessimistic of the two available signals: ComfyUI's number cannot be
  // trusted alone (see signals/studio.ts), and residency arithmetic is exact.
  const byResidency =
    signals.vramTotalBytes !== undefined && signals.residentVramBytes !== undefined
      ? signals.vramTotalBytes - signals.residentVramBytes
      : undefined;
  const estimates = [signals.vramFreeBytes, byResidency].filter((n): n is number => typeof n === 'number');
  if (estimates.length > 0) {
    const effectiveFreeBytes = Math.min(...estimates);
    signals.effectiveFreeBytes = effectiveFreeBytes;
    if (effectiveFreeBytes < input.thresholds.coldLoadHeadroomBytes) {
      return decided({ state: 'busy', reason: 'insufficient-vram', message: BUSY_MESSAGE, signals });
    }
  }

  return decided({ state: 'ready', reason: 'headroom-available', signals });
}

/** Finish a classification that needed the card to prove it had cycles. */
export function applyComputeProbe(signals: CapacitySignals, compute: ComputeReading): CapacityReading {
  const withProbe: CapacitySignals = { ...signals, computeResponsive: compute.ok, computeProbeMs: compute.ms };
  if (compute.ok) return { state: 'ready', reason: 'compute-verified', signals: withProbe };
  /*
   * 🚨 ONLY CLAIM A COMPETING RENDER WHEN ONE WAS SEEN.
   *
   * A failed probe proves the card did not produce a token in time. It does NOT
   * prove what was using it. The probe also runs when ComfyUI is merely
   * UNREACHABLE — which is what a STOPPED ComfyUI looks like — and telling a user
   * the card is "busy with another task" there sent someone hunting for a workload
   * that had already been shut down.
   */
  const renderConfirmed = (signals.comfyRunning ?? 0) > 0;
  return {
    state: 'busy',
    reason: 'compute-starved',
    message: renderConfirmed ? BUSY_MESSAGE : UNRESPONSIVE_MESSAGE,
    signals: withProbe,
  };
}

/**
 * Should this reading stop the turn before any model request is sent?
 *
 * Only `busy` and `unavailable` do. `unknown` deliberately ADMITS: a monitoring
 * outage must never become an outage of the thing being monitored.
 */
export function shouldRefuse(reading: Pick<CapacityReading, 'state'>): boolean {
  return reading.state === 'busy' || reading.state === 'unavailable';
}
