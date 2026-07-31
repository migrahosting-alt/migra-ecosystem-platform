// MigraPilot — Brain CONNECTION readiness, deliberately separate from operation state.
//
// A health probe describes the transport; an operation describes work the user asked
// for. They share the transport primitive and the failure taxonomy, but they must NOT
// share a mutable record: a routine health poll failing while a run is completing
// must never rewrite that run's terminal outcome.
//
// This module therefore owns its own record and exposes no way to reach an operation.

import type { FailureCategory } from './executionState.js';
import { classifyTransportFailure, type FailureEvidence } from './brainTransport.js';

/** Readiness is a strict subset of ExecutionState — an endpoint is never `running`,
 * `cancelling`, `cancelled` or `completed`; only work is. */
export type ConnectionReadiness =
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'degraded'
  | 'failed';

export interface ConnectionRecord {
  readonly endpoint: string;
  readiness: ConnectionReadiness;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureCategory?: FailureCategory;
  /** Consecutive unrecoverable failures. Reset by any success. */
  consecutiveFailures: number;
  reconnectAttempts: number;
  /** Reported by the Brain when it exposes one; absent otherwise. */
  brainProcessId?: number;
}

/** Failures that mean "nothing is listening" rather than "it answered badly". */
const DISCONNECTING: ReadonlySet<FailureCategory> = new Set([
  'connection_refused',
  'brain_process_exit',
]);

/** Failures where the endpoint responded but unusably — recoverable, so degrade. */
const DEGRADING: ReadonlySet<FailureCategory> = new Set([
  'invalid_response',
  'request_timeout',
  'connection_lost',
  'terminal_state_unverified',
]);

export interface ConnectionOptions {
  /** Consecutive unrecoverable failures before readiness becomes `failed`. */
  failureThreshold: number;
}

const DEFAULTS: ConnectionOptions = { failureThreshold: 3 };

/**
 * Tracks Brain availability. Every mutation is driven by an OBSERVED probe result —
 * there is no method that sets `ready` without evidence.
 */
export class BrainConnectionState {
  private readonly record: ConnectionRecord;

  constructor(
    endpoint: string,
    private readonly options: ConnectionOptions = DEFAULTS,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.record = {
      endpoint,
      readiness: 'disconnected',
      consecutiveFailures: 0,
      reconnectAttempts: 0,
    };
  }

  get readiness(): ConnectionReadiness {
    return this.record.readiness;
  }

  snapshot(): ConnectionRecord {
    return JSON.parse(JSON.stringify(this.record)) as ConnectionRecord;
  }

  /** A probe has been dispatched. */
  probeStarted(): void {
    this.record.reconnectAttempts += 1;
    // A probe from a failed/disconnected endpoint is a reconnect attempt; from a
    // ready one it is routine and must not downgrade the displayed readiness.
    if (this.record.readiness !== 'ready') this.record.readiness = 'connecting';
  }

  /** A health response was received AND validated. */
  probeSucceeded(brainProcessId?: number): void {
    this.record.readiness = 'ready';
    this.record.lastSuccessAt = this.clock();
    this.record.consecutiveFailures = 0;
    if (brainProcessId !== undefined) this.record.brainProcessId = brainProcessId;
  }

  /**
   * A probe failed. Readiness is derived from the OBSERVED category, not from a
   * generic error, and escalates to `failed` only past the configured threshold.
   */
  probeFailed(evidence: FailureEvidence): ConnectionReadiness {
    const { category } = classifyTransportFailure(evidence);
    this.record.lastFailureAt = this.clock();
    this.record.lastFailureCategory = category;
    this.record.consecutiveFailures += 1;

    if (this.record.consecutiveFailures >= this.options.failureThreshold) {
      this.record.readiness = 'failed';
    } else if (DISCONNECTING.has(category)) {
      this.record.readiness = 'disconnected';
    } else if (DEGRADING.has(category)) {
      this.record.readiness = 'degraded';
    } else {
      this.record.readiness = 'degraded';
    }
    return this.record.readiness;
  }

  /** Operator-facing line. Never optimistic, never invents a reason. */
  statusLine(): string {
    const r = this.record;
    switch (r.readiness) {
      case 'ready':
        return `Brain ready at ${r.endpoint}.`;
      case 'connecting':
        return `Connecting to ${r.endpoint}…`;
      case 'disconnected':
        return `Brain not reachable at ${r.endpoint} (${r.lastFailureCategory ?? 'no response'}).`;
      case 'degraded':
        return `Brain degraded at ${r.endpoint} (${r.lastFailureCategory ?? 'unusable response'}).`;
      case 'failed':
        return `Brain unavailable at ${r.endpoint} after ${r.consecutiveFailures} consecutive failures (${r.lastFailureCategory ?? 'unknown'}).`;
    }
  }
}
