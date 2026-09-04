/**
 * Admission control — the contracts.
 *
 * Types only. Kept apart from the policy that reads them and the probes that fill
 * them, so the classification can be exercised exhaustively without a network and
 * a new signal cannot quietly change what a decision means.
 *
 * © MigraTeck LLC.
 */

/** Coarse enough to act on, honest enough to show a user. */
export type CapacityState = 'ready' | 'busy' | 'unavailable' | 'unknown';

/** What the gate did with a turn. Distinct from CapacityState: `unknown`
 *  capacity ADMITS, and conflating the two is how fail-open gets lost. */
export type AdmissionOutcome = 'admitted' | 'refused';

/**
 * Why the policy decided what it decided.
 *
 * A machine-readable reason, so telemetry can aggregate causes and an operator can
 * tell "the card is rendering" from "the inference server is down" without parsing
 * a sentence written for end users.
 */
export type AdmissionReason =
  /** Nothing competing; the model is loaded and can answer immediately. */
  | 'resident-idle'
  /** Something was competing, and the card still returned a token. */
  | 'compute-verified'
  /** Something was competing and the card would not return a token. */
  | 'compute-starved'
  /** A render owns the card and this turn needs a cold load behind it. */
  | 'render-holds-card'
  /** Not resident, and not enough headroom to bring the model in. */
  | 'insufficient-vram'
  /** The inference server itself is not answering. An outage, not contention. */
  | 'inference-unreachable'
  /** Enough headroom, nothing competing. */
  | 'headroom-available'
  /** Probes unreadable. Admits — a monitoring outage is not a service outage. */
  | 'signals-unreadable'
  /** Admission control is not engaged for this deployment (stub provider). */
  | 'not-applicable';

export interface CapacitySignals {
  /** ComfyUI jobs executing now. Non-zero means the card is committed. */
  comfyRunning?: number;
  comfyPending?: number;
  /** Coarse headroom hint. Measurably optimistic — never trusted alone. */
  vramFreeBytes?: number;
  vramTotalBytes?: number;
  /** Models the inference server currently holds in VRAM. */
  residentModels?: string[];
  /** VRAM those resident models hold. Exact, unlike the ComfyUI figure. */
  residentVramBytes?: number;
  /** The pessimistic free-VRAM estimate the decision actually uses. */
  effectiveFreeBytes?: number;
  /** Whether the model this turn needs is already loaded. */
  modelResident?: boolean;
  /** Did a one-token generation actually come back? Compute, not memory. */
  computeResponsive?: boolean;
  /** How long that probe took, in ms. Recorded whether it passed or failed. */
  computeProbeMs?: number;
  /** Probes that could not be reached, by name. */
  unreachable?: string[];
}

/** The policy's verdict. Pure data — no I/O has happened to produce the state. */
export interface CapacityReading {
  state: CapacityState;
  reason: AdmissionReason;
  /** What the user is told, when they need to be told anything. */
  message?: string;
  signals: CapacitySignals;
}

/** What a caller gets back from the gate, and everything it needs to act. */
export interface AdmissionDecision extends CapacityReading {
  outcome: AdmissionOutcome;
  /** Stable code for the wire and for audit. Absent when admitted. */
  code?: 'GPU_BUSY' | 'ENGINE_UNAVAILABLE';
  /** True when this decision was served from cache rather than freshly probed. */
  cached: boolean;
  /** Age of the reading in ms. Zero for a fresh probe. */
  ageMs: number;
}
