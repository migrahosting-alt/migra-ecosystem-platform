// Structured, LOCAL-ONLY backend-selection diagnostics (observability slice).
// Records why the router resolved to a backend, in a sanitized form, for the P6
// operational-validation evidence set. Purely observational: nothing here can
// trigger resolution, repair, startup, fallback, or a backend switch.
//
// SANITIZED BY CONSTRUCTION: an event contains only enums, a protocol version
// number, and coarse boolean support flags — never tokens, keys, authorization
// headers, approval ids, URLs, capability payloads, or raw response bodies.

import { type CapabilityState } from '@migrapilot/pilot-client';

export type LocalProbe = 'ready' | 'down' | 'conflict' | 'unknown';
export type RemoteProbe = 'ready' | 'unauthorized' | 'incompatible' | 'unavailable' | 'n/a';
export type SelectionSource = 'explicit' | 'auto';
export type ResolutionTrigger = 'activation' | 're-resolve';
export type ResolvedBackendKind = 'local' | 'remote' | 'remote-unavailable';

export type DecisionReason =
  | 'local-mode-configured'
  | 'remote-ready'
  | 'remote-not-ready'
  | 'remote-error'
  | 'auto-remote-ready'
  | 'auto-remote-not-ready-local-selected'
  | 'auto-remote-error-local-selected';

/** Structured info the router emits after each resolution (observational). */
export interface ResolutionInfo {
  mode: string;
  backend: ResolvedBackendKind;
  reason: DecisionReason;
  remoteProbe: RemoteProbe;
  protocolVersion?: number;
  supported?: { streaming: boolean; approvals: boolean };
}

export interface ResolutionEvent extends ResolutionInfo {
  at: number;
  source: SelectionSource;
  trigger: ResolutionTrigger;
  localProbe: LocalProbe;
  changed: boolean;
  changedFrom: ResolvedBackendKind | null;
}

export interface DiagnosticSnapshot {
  current?: ResolutionEvent;
  history: ResolutionEvent[];
}

/** Map a capability-negotiation state to a coarse, non-sensitive remote probe. */
export function classifyRemoteProbe(state: CapabilityState): RemoteProbe {
  switch (state.status) {
    case 'ready':
      return 'ready';
    case 'unauthorized':
      return 'unauthorized';
    case 'incompatible':
      return 'incompatible';
    case 'degraded':
      return 'unavailable';
  }
}

export class BackendDiagnostics {
  private history: ResolutionEvent[] = [];
  private lastBackend: ResolvedBackendKind | undefined;

  constructor(
    private readonly clock: () => number,
    private readonly max = 20,
  ) {}

  record(
    info: ResolutionInfo,
    meta: { source: SelectionSource; trigger: ResolutionTrigger; localProbe?: LocalProbe },
  ): ResolutionEvent {
    const changedFrom = this.lastBackend ?? null;
    const changed = this.lastBackend !== undefined && this.lastBackend !== info.backend;
    const event: ResolutionEvent = {
      ...info,
      at: this.clock(),
      source: meta.source,
      trigger: meta.trigger,
      localProbe: meta.localProbe ?? 'unknown',
      changed,
      changedFrom,
    };
    this.lastBackend = info.backend;
    this.history.push(event);
    if (this.history.length > this.max) {
      this.history.shift();
    }
    return event;
  }

  /** Attach the local-brain probe outcome to the most recent event (the lifecycle
   * result arrives after resolution in the activation path). Observational only. */
  annotateLocalProbe(probe: LocalProbe): void {
    const last = this.history[this.history.length - 1];
    if (last) {
      last.localProbe = probe;
    }
  }

  snapshot(): DiagnosticSnapshot {
    const current = this.history[this.history.length - 1];
    return { current, history: [...this.history] };
  }

  clear(): void {
    this.history = [];
    this.lastBackend = undefined;
  }
}
