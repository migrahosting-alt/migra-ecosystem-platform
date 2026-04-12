import type { AutonomyConfig, ConfidenceState } from "./types";

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function applyConfidenceSuccess(state: ConfidenceState): ConfidenceState {
  return {
    ...state,
    score: clamp(state.score + 0.02),
    lastUpdated: new Date().toISOString(),
    recentSuccesses: state.recentSuccesses + 1
  };
}

export function applyConfidenceRetry(state: ConfidenceState, config: AutonomyConfig): ConfidenceState {
  return {
    ...state,
    score: clamp(state.score - config.confidenceGate.decayOnRetry),
    lastUpdated: new Date().toISOString()
  };
}

export function applyConfidenceFailure(state: ConfidenceState, config: AutonomyConfig): ConfidenceState {
  return {
    ...state,
    score: clamp(state.score - config.confidenceGate.decayOnFailure),
    lastUpdated: new Date().toISOString(),
    recentFailures: state.recentFailures + 1
  };
}

export function confidenceGateTripped(state: ConfidenceState, config: AutonomyConfig): boolean {
  return state.score < config.confidenceGate.minConfidenceToContinue;
}
