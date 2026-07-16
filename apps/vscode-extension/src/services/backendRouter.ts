// BackendRouter — resolves the active backend ONCE per activation/repair and
// routes chat through it. Encodes the P2 invariants (see
// docs/pilot-api-integration-plan.md §8):
//
//  - mode resolved once, not per request;
//  - `auto` may probe+select, but never silently switches after a request begins;
//  - a remote-pilot failure surfaces as a correlated PilotError — the same
//    request is NEVER re-routed to the local stub;
//  - remote mode is not activated when negotiation is degraded/unauthorized/
//    malformed/incompatible;
//  - cancellation propagates through to the pilot SSE stream.
//
// Intentionally free of any `vscode` import so it is unit-testable. The vscode
// layer supplies a LocalChatBackend (over brainClient) and a mode() provider.

import { type ResolutionInfo, classifyRemoteProbe } from './backendDiagnostics.js';
import { type CapabilityState, type PilotCapabilities } from '@migrapilot/pilot-client';
import { PilotError } from '@migrapilot/pilot-client';
import { type PilotApiClient } from '@migrapilot/pilot-client';

export type BackendMode = 'local-brain' | 'remote-pilot' | 'auto';

export interface LocalChatResult {
  content: string;
  citations?: Array<{ path: string; startLine: number; endLine: number }>;
}

/** The local chat surface, injected so the router stays vscode-free. `request`
 * is the brain ChatTurnRequest, treated opaquely here. A cancellation signal is
 * threaded through so a provider-backed local implementation can be cancelled. */
export interface LocalChatBackend {
  chat(request: unknown, signal?: AbortSignal): Promise<LocalChatResult>;
}

export interface RouterChatTurn {
  requestId: string;
  /** Payload for the local brain backend (brain ChatTurnRequest). */
  local: unknown;
  /** Body for pilot `POST /api/pilot/chat/stream`. */
  remote: unknown;
}

export type ChatChunk =
  | { type: 'token'; text: string }
  | { type: 'plan'; data: unknown }
  | { type: 'info'; event: string; data: unknown }
  | { type: 'message'; content: string; citations?: LocalChatResult['citations'] }
  | { type: 'done'; runId?: string };

export type ResolvedBackend =
  | { kind: 'local'; note?: string }
  | { kind: 'remote'; caps: PilotCapabilities }
  | { kind: 'remote-unavailable'; error: PilotError; state?: CapabilityState };

export interface RouterDeps {
  mode(): BackendMode;
  local: LocalChatBackend;
  pilot: PilotApiClient;
  log(message: string): void;
  /** Observational hook fired after each resolution. MUST NOT affect selection —
   * it is called for diagnostics only and its errors are swallowed. */
  onResolution?(info: ResolutionInfo): void;
}

export class BackendRouter {
  private resolved: ResolvedBackend | undefined;
  private resolving: Promise<ResolvedBackend> | undefined;

  constructor(private readonly deps: RouterDeps) {}

  /** The already-resolved backend, or undefined before first resolve. */
  current(): ResolvedBackend | undefined {
    return this.resolved;
  }

  /**
   * Resolve the backend once. Concurrent callers share the in-flight resolution.
   * Pass force=true (explicit repair / mode change) to re-resolve.
   */
  async resolve(force = false, signal?: AbortSignal): Promise<ResolvedBackend> {
    if (!force && this.resolved) {
      return this.resolved;
    }
    if (!force && this.resolving) {
      return this.resolving;
    }
    this.resolving = this.doResolve(signal)
      .then((r) => {
        this.resolved = r;
        return r;
      })
      .finally(() => {
        this.resolving = undefined;
      });
    return this.resolving;
  }

  /** Emit an observational resolution event. Guarded so a faulty listener can
   * never affect the resolution result (diagnostics are observation-only). */
  private emit(info: ResolutionInfo): void {
    try {
      this.deps.onResolution?.(info);
    } catch {
      /* observational — never propagate */
    }
  }

  private async doResolve(signal?: AbortSignal): Promise<ResolvedBackend> {
    const mode = this.deps.mode();
    if (mode === 'local-brain') {
      this.deps.log('backend resolved: local-brain');
      this.emit({ mode, backend: 'local', reason: 'local-mode-configured', remoteProbe: 'n/a' });
      return { kind: 'local' };
    }

    // remote-pilot or auto: negotiate capabilities (authenticated).
    let state: CapabilityState;
    try {
      state = await this.deps.pilot.negotiateCapabilities(signal);
    } catch (err) {
      const pilotErr =
        err instanceof PilotError
          ? err
          : new PilotError('NETWORK', 'Pilot negotiation failed.', { cause: err });
      if (mode === 'auto') {
        this.deps.log(`auto: pilot unreachable (${pilotErr.code}) → local-brain`);
        this.emit({ mode, backend: 'local', reason: 'auto-remote-error-local-selected', remoteProbe: 'unavailable' });
        return { kind: 'local', note: `auto→local (${pilotErr.code})` };
      }
      this.deps.log(`remote-pilot: negotiation error ${pilotErr.code} — remote unavailable`);
      this.emit({ mode, backend: 'remote-unavailable', reason: 'remote-error', remoteProbe: 'unavailable' });
      return { kind: 'remote-unavailable', error: pilotErr };
    }

    if (state.status === 'ready') {
      this.deps.log(`backend resolved: remote-pilot (protocol ${state.caps.protocolVersion})`);
      this.emit({
        mode,
        backend: 'remote',
        reason: mode === 'auto' ? 'auto-remote-ready' : 'remote-ready',
        remoteProbe: 'ready',
        protocolVersion: state.caps.protocolVersion,
        supported: { streaming: state.caps.streaming, approvals: state.caps.approvals },
      });
      return { kind: 'remote', caps: state.caps };
    }

    // Negotiation not ready → remote must NOT be activated.
    if (mode === 'auto') {
      this.deps.log(`auto: remote not ready (${describeState(state)}) → local-brain`);
      this.emit({
        mode,
        backend: 'local',
        reason: 'auto-remote-not-ready-local-selected',
        remoteProbe: classifyRemoteProbe(state),
      });
      return { kind: 'local', note: `auto→local (${describeState(state)})` };
    }
    const error = capabilityStateToError(state);
    this.deps.log(`remote-pilot: ${describeState(state)} — remote unavailable`);
    this.emit({ mode, backend: 'remote-unavailable', reason: 'remote-not-ready', remoteProbe: classifyRemoteProbe(state) });
    return { kind: 'remote-unavailable', error, state };
  }

  /**
   * Route a chat turn to the resolved backend. Uses the CURRENT resolution — it
   * never re-resolves mid-request, so `auto` cannot silently switch backends
   * once a request has begun. A remote failure throws a correlated PilotError
   * and is never re-routed to the local stub.
   */
  async *chat(turn: RouterChatTurn, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
    const backend = this.resolved ?? (await this.resolve());

    if (backend.kind === 'remote-unavailable') {
      // Surface the correlated error; do NOT fall back to the stub.
      throw withRequestId(backend.error, turn.requestId);
    }

    if (backend.kind === 'local') {
      const result = await this.deps.local.chat(turn.local, signal);
      yield { type: 'message', content: result.content, citations: result.citations };
      yield { type: 'done' };
      return;
    }

    // remote
    yield* this.streamRemote(turn, signal);
  }

  private async *streamRemote(turn: RouterChatTurn, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
    for await (const ev of this.deps.pilot.chatStream(turn.remote, signal)) {
      switch (ev.event) {
        case 'token': {
          const text = typeof ev.data === 'string' ? ev.data : String((ev.data as { text?: unknown })?.text ?? '');
          if (text) {
            yield { type: 'token', text };
          }
          break;
        }
        case 'plan':
          yield { type: 'plan', data: ev.data };
          break;
        case 'completed':
        case 'done': {
          const runId = (ev.data as { runId?: string })?.runId;
          yield { type: 'done', runId };
          break;
        }
        case 'error': {
          const message = String((ev.data as { message?: unknown })?.message ?? 'Pilot stream error.');
          throw new PilotError('SERVER_ERROR', message, { requestId: turn.requestId });
        }
        default:
          yield { type: 'info', event: ev.event, data: ev.data };
      }
    }
  }
}

/** Human-readable label for the status bar. */
export function backendLabel(resolved: ResolvedBackend | undefined): string {
  if (!resolved) {
    return 'resolving…';
  }
  switch (resolved.kind) {
    case 'local':
      return 'local';
    case 'remote':
      return 'pilot-api';
    case 'remote-unavailable':
      return `pilot-api unavailable (${resolved.error.code})`;
  }
}

function describeState(state: CapabilityState): string {
  switch (state.status) {
    case 'ready':
      return 'ready';
    case 'degraded':
      return `degraded:${state.reason}`;
    case 'incompatible':
      return `incompatible:v${state.observedProtocolVersion}`;
    case 'unauthorized':
      return 'unauthorized';
  }
}

function capabilityStateToError(state: CapabilityState): PilotError {
  switch (state.status) {
    case 'unauthorized':
      return new PilotError('AUTH_REQUIRED', 'Pilot requires authentication.');
    case 'incompatible':
      return new PilotError(
        'CAPABILITY_INCOMPATIBLE',
        `Pilot protocol v${state.observedProtocolVersion} is incompatible.`,
      );
    case 'degraded':
      return state.reason === 'malformed'
        ? new PilotError('CAPABILITY_MALFORMED', 'Pilot returned a malformed capability response.')
        : new PilotError('CAPABILITY_MISSING', 'Pilot capability negotiation unavailable.');
    case 'ready':
      // Not an error state; only reached defensively.
      return new PilotError('SERVER_ERROR', 'Unexpected ready state treated as error.');
  }
}

function withRequestId(error: PilotError, requestId: string): PilotError {
  if (error.requestId) {
    return error;
  }
  return new PilotError(error.code, error.message, {
    httpStatus: error.httpStatus,
    retriable: error.retriable,
    requestId,
    cause: error.cause,
  });
}
