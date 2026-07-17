// Incident + alert pipeline (Operational Readiness Slice 3). Turns an
// INCONSISTENT_STATE workspace-application failure into a critical, deduplicated
// incident with an honest delivery record. Alerts carry SAFE METADATA ONLY.

import { randomUUID } from 'node:crypto';

export type IncidentState = 'open' | 'acknowledged' | 'resolved' | 'notification_failed';

export interface InconsistentStateAlert {
  severity: 'critical';
  event: 'workspace_application_inconsistent_state';
  correlation_id: string;
  workspace_identity_hash: string;
  proposal_hash_prefix: string;
  applied_file_count: number;
  affected_path_count: number;
  rollback_failure_count: number;
  failure_stage: string;
  first_seen_at: number;
  last_seen_at: number;
  deduplication_key: string;
}

export interface Incident {
  incidentId: string;
  deduplicationKey: string;
  correlationId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
  state: IncidentState;
  severity: 'critical';
  affected: {
    workspace_identity_hash: string;
    proposal_hash_prefix: string;
    applied_file_count: number;
    affected_path_count: number;
    rollback_failure_count: number;
    failure_stage: string;
  };
  lastDeliveryStatus: 'delivered' | 'failed' | 'none';
  resolution?: { at: number; note: string };
}

/** Pluggable alert transport. The default local sink records deliveries; a
 * production paging integration is NOT added in this slice. A sink may throw —
 * a delivery failure is recorded honestly, never swallowed into "delivered". */
export type AlertSink = (alert: InconsistentStateAlert) => void;

/** Default local sink: append to an in-memory delivery log (dev/default). */
export class LocalAlertSink {
  readonly delivered: InconsistentStateAlert[] = [];
  readonly sink: AlertSink = (alert) => {
    this.delivered.push(alert);
  };
}

export interface RaiseInput {
  correlationId: string;
  workspaceIdentityHash: string;
  proposalHashPrefix: string;
  appliedFileCount: number;
  affectedPathCount: number;
  rollbackFailureCount: number;
  failureStage: string;
}

export interface IncidentHealth {
  status: 'healthy' | 'degraded';
  open_incidents: number;
  total_incidents: number;
  total_occurrences: number;
  notifications_delivered: number;
  notifications_failed: number;
  last_delivery_status: 'delivered' | 'failed' | 'none';
}

export class IncidentManager {
  private readonly byKey = new Map<string, Incident>();
  private readonly byId = new Map<string, Incident>();
  private notificationsDelivered = 0;
  private notificationsFailed = 0;
  private lastDelivery: 'delivered' | 'failed' | 'none' = 'none';

  constructor(
    private readonly sink: AlertSink,
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = randomUUID,
  ) {}

  /** Deterministic dedup: same workspace + proposal + failure stage = one
   * incident (repeat occurrences increment, do NOT re-notify). */
  private dedupKey(i: RaiseInput): string {
    return `${i.workspaceIdentityHash}:${i.proposalHashPrefix}:${i.failureStage}`;
  }

  raiseInconsistentState(input: RaiseInput): { incident: Incident; notified: boolean } {
    const key = this.dedupKey(input);
    const at = this.now();
    const existing = this.byKey.get(key);
    if (existing) {
      // Deduplicated: increment occurrence + counter, do NOT re-notify.
      existing.occurrenceCount += 1;
      existing.lastSeenAt = at;
      // A repeat on a resolved incident reopens it (do not auto-resolve).
      if (existing.state === 'resolved') existing.state = 'open';
      return { incident: existing, notified: false };
    }
    const incident: Incident = {
      incidentId: this.mkId(),
      deduplicationKey: key,
      correlationId: input.correlationId,
      firstSeenAt: at,
      lastSeenAt: at,
      occurrenceCount: 1,
      state: 'open',
      severity: 'critical',
      affected: {
        workspace_identity_hash: input.workspaceIdentityHash,
        proposal_hash_prefix: input.proposalHashPrefix,
        applied_file_count: input.appliedFileCount,
        affected_path_count: input.affectedPathCount,
        rollback_failure_count: input.rollbackFailureCount,
        failure_stage: input.failureStage,
      },
      lastDeliveryStatus: 'none',
    };
    this.byKey.set(key, incident);
    this.byId.set(incident.incidentId, incident);
    this.notify(incident);
    return { incident, notified: true };
  }

  private notify(incident: Incident): void {
    const alert: InconsistentStateAlert = {
      severity: 'critical',
      event: 'workspace_application_inconsistent_state',
      correlation_id: incident.correlationId,
      workspace_identity_hash: incident.affected.workspace_identity_hash,
      proposal_hash_prefix: incident.affected.proposal_hash_prefix,
      applied_file_count: incident.affected.applied_file_count,
      affected_path_count: incident.affected.affected_path_count,
      rollback_failure_count: incident.affected.rollback_failure_count,
      failure_stage: incident.affected.failure_stage,
      first_seen_at: incident.firstSeenAt,
      last_seen_at: incident.lastSeenAt,
      deduplication_key: incident.deduplicationKey,
    };
    try {
      this.sink(alert);
      incident.lastDeliveryStatus = 'delivered';
      this.notificationsDelivered += 1;
      this.lastDelivery = 'delivered';
    } catch {
      // Honest delivery failure — the incident is retained + flagged, never lost.
      incident.lastDeliveryStatus = 'failed';
      incident.state = 'notification_failed';
      this.notificationsFailed += 1;
      this.lastDelivery = 'failed';
    }
  }

  acknowledge(incidentId: string): Incident | undefined {
    const inc = this.byId.get(incidentId);
    if (inc && (inc.state === 'open' || inc.state === 'notification_failed')) inc.state = 'acknowledged';
    return inc;
  }

  /** Explicit resolution only — never auto-resolved by a later success. */
  resolve(incidentId: string, note: string): Incident | undefined {
    const inc = this.byId.get(incidentId);
    if (inc) {
      inc.state = 'resolved';
      inc.resolution = { at: this.now(), note };
    }
    return inc;
  }

  get(incidentId: string): Incident | undefined {
    return this.byId.get(incidentId);
  }
  list(limit = 200): Incident[] {
    return [...this.byId.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, limit);
  }

  health(): IncidentHealth {
    const incidents = [...this.byId.values()];
    const open = incidents.filter((i) => i.state === 'open' || i.state === 'notification_failed').length;
    return {
      status: this.notificationsFailed > 0 && this.lastDelivery === 'failed' ? 'degraded' : 'healthy',
      open_incidents: open,
      total_incidents: incidents.length,
      total_occurrences: incidents.reduce((n, i) => n + i.occurrenceCount, 0),
      notifications_delivered: this.notificationsDelivered,
      notifications_failed: this.notificationsFailed,
      last_delivery_status: this.lastDelivery,
    };
  }
}

/** Process-wide local alert sink + incident manager. */
export const localAlertSink = new LocalAlertSink();
export const incidentManager = new IncidentManager(localAlertSink.sink);
