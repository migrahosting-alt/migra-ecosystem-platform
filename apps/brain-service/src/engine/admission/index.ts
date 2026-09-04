/**
 * Admission control — can this turn actually be served right now?
 *
 * The narrow surface every caller should use. Importing deeper than this is a
 * smell: the layers below are signals, a pure policy, and enforcement, and they
 * are split so the policy can be tested as data rather than mocked over a network.
 *
 * USAGE — one call, before any model work:
 *
 *     const decision = await gate.admit({ model: chosen.id });
 *     if (decision.outcome === 'refused') {  // fail fast, truthfully
 *       send('refusal', { code: decision.code, message: decision.message, capacity: decision.state });
 *       return;
 *     }
 *
 * © MigraTeck LLC.
 */

export { AdmissionGate, type AdmitRequest, type GateConfig } from './gate.js';
export { admissionCounters, resetAdmissionCounters, type AdmissionCounters } from './telemetry.js';
export { DEFAULT_THRESHOLDS, resolveThresholds, type AdmissionThresholds } from './thresholds.js';
export { BUSY_MESSAGE, UNAVAILABLE_MESSAGE } from './messages.js';
export { isModelResident } from './signals/inference.js';
export { applyComputeProbe, classify, shouldRefuse, type PolicyInput, type PolicyStep } from './policy.js';
export type {
  AdmissionDecision, AdmissionOutcome, AdmissionReason,
  CapacityReading, CapacitySignals, CapacityState,
} from './types.js';
