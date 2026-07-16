import { type ResolutionEvent } from '../../services/backendDiagnostics.js';

// Helpers for the P6 operational-validation harness. Derives the user-facing
// status + recovery path from a sanitized diagnostic event (the status-bar
// rendering is deterministic from the resolved state, but the VS Code API does
// not expose reading a StatusBarItem's text — so we reproduce the same mapping).
// Purely observational: these never trigger resolution/repair.

export interface EvidenceRecord {
  scenario: string;
  configuredMode: string;
  selectedBackend: string;
  decisionReason: string;
  localProbe: string;
  remoteProbe: string;
  changed: boolean;
  userFacingStatus: string;
  recoveryPath: string;
  noSilentFallback: boolean;
  portState: { brainPort: number; occupied: boolean; ownedByExtension: boolean };
  at: number;
}

/** The status text the status bar would render for this resolved state. */
export function deriveUserFacingStatus(ev: ResolutionEvent): string {
  if (ev.backend === 'remote') {
    return 'MigraPilot: pilot-api';
  }
  if (ev.backend === 'remote-unavailable') {
    return `MigraPilot: pilot-api unavailable (${ev.remoteProbe})`;
  }
  // local
  if (ev.localProbe === 'conflict' || ev.localProbe === 'down') {
    return 'MigraPilot: local (degraded)';
  }
  return 'MigraPilot: local';
}

/** The recovery action offered to the user for this state. */
export function deriveRecoveryPath(ev: ResolutionEvent): string {
  if (ev.backend === 'remote-unavailable') {
    return ev.remoteProbe === 'unauthorized'
      ? 'Set Pilot Service Token, then Repair Connection'
      : 'Repair Connection once pilot-api is reachable/compatible';
  }
  if (ev.backend === 'local' && (ev.localProbe === 'conflict' || ev.localProbe === 'down')) {
    return ev.localProbe === 'conflict'
      ? 'Free the brain port or configure a different brainUrl, then Repair Connection'
      : 'Configure migrapilot.brainAutoStartCommand or start the brain, then Repair Connection';
  }
  return 'none';
}

/**
 * Whether the "no silent fallback" invariant held. For an explicitly-selected
 * remote-pilot failure the backend MUST remain remote-unavailable (never local).
 */
export function noSilentFallback(ev: ResolutionEvent): boolean {
  if (ev.mode === 'remote-pilot') {
    // A remote-pilot resolution must never end on the local backend.
    return ev.backend !== 'local';
  }
  return true; // local/auto: selecting local is by-design, not a silent fallback
}
