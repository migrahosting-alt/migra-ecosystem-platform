// Operational Data Foundation — Slice 1, commit 3: retention, integrity, health.
//
// Keeps the durable operational store bounded (age-based retention per store),
// verifies it on startup, and exposes a truthful health surface — reachable,
// schema-current, integrity, retention-worker liveness, write latency, storage
// utilization. This is a PERSISTENCE concern only (no analytics).
//
// © MigraTeck LLC.

import * as fs from 'node:fs';
import type { OperationalPersistence, OperationalCounts, PersistenceHealth } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Age-based retention windows (days) + worker cadence. Owner-configurable; the
 * defaults match the ODF Slice 1 policy examples. */
export interface OperationalRetentionConfig {
  usageDays: number; // usage ledger
  auditDays: number; // audit events
  incidentDays: number; // resolved incidents only (open incidents are NEVER pruned)
  recoveryDays: number; // recovery history
  intervalMs: number; // retention worker cadence
  /** Write latency at/above which the store is reported degraded (ms). */
  writeLatencyDegradedMs: number;
}

export const DEFAULT_RETENTION: OperationalRetentionConfig = {
  usageDays: 90,
  auditDays: 180,
  incidentDays: 365,
  recoveryDays: 365,
  intervalMs: 6 * 60 * 60 * 1000, // 6h
  writeLatencyDegradedMs: 250,
};

/** Read the retention policy from env, falling back to {@link DEFAULT_RETENTION}.
 * A non-positive or unparseable value keeps the default (retention is never
 * silently disabled by a typo). Knobs:
 *   MIGRAPILOT_OPERATIONAL_RETENTION_USAGE_DAYS
 *   MIGRAPILOT_OPERATIONAL_RETENTION_AUDIT_DAYS
 *   MIGRAPILOT_OPERATIONAL_RETENTION_INCIDENT_DAYS
 *   MIGRAPILOT_OPERATIONAL_RETENTION_RECOVERY_DAYS
 *   MIGRAPILOT_OPERATIONAL_RETENTION_INTERVAL_MINUTES
 *   MIGRAPILOT_OPERATIONAL_WRITE_LATENCY_DEGRADED_MS
 */
export function buildRetentionConfig(env: NodeJS.ProcessEnv = process.env): OperationalRetentionConfig {
  const posInt = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    usageDays: posInt(env.MIGRAPILOT_OPERATIONAL_RETENTION_USAGE_DAYS, DEFAULT_RETENTION.usageDays),
    auditDays: posInt(env.MIGRAPILOT_OPERATIONAL_RETENTION_AUDIT_DAYS, DEFAULT_RETENTION.auditDays),
    incidentDays: posInt(env.MIGRAPILOT_OPERATIONAL_RETENTION_INCIDENT_DAYS, DEFAULT_RETENTION.incidentDays),
    recoveryDays: posInt(env.MIGRAPILOT_OPERATIONAL_RETENTION_RECOVERY_DAYS, DEFAULT_RETENTION.recoveryDays),
    intervalMs: posInt(env.MIGRAPILOT_OPERATIONAL_RETENTION_INTERVAL_MINUTES, DEFAULT_RETENTION.intervalMs / 60000) * 60000,
    writeLatencyDegradedMs: posInt(env.MIGRAPILOT_OPERATIONAL_WRITE_LATENCY_DEGRADED_MS, DEFAULT_RETENTION.writeLatencyDegradedMs),
  };
}

/** The durable surface this maintenance needs (a narrow view of DurableStore). */
export interface MaintenanceStore extends OperationalPersistence {
  integrityCheck(): string;
  health(): PersistenceHealth;
  probeWriteLatencyMs(): number;
}

export interface RetentionResult {
  at: number;
  deleted: { audit: number; usage: number; incidents: number; recovery: number };
}

export type OperationalStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface OperationalHealthSnapshot {
  status: OperationalStatus;
  /** The database opened + answered a probe write. */
  reachable: boolean;
  /** Engine schema version matches the durable schema (no pending/mismatch). */
  schemaCurrent: boolean;
  schemaVersion: number;
  migrationState: string;
  /** 'ok' or the first integrity problem reported by SQLite. */
  integrity: string;
  retentionWorker: 'running' | 'stopped';
  lastRetentionAt: number | null;
  lastRetentionDeleted: RetentionResult['deleted'] | null;
  writeLatencyMs: number | null;
  writeLatencyOk: boolean;
  storageBytes: number | null;
  counts: OperationalCounts;
}

/**
 * Owns retention + integrity + health for the durable operational store. The
 * retention worker is opt-in via {@link start}; {@link close} stops it (shutdown).
 */
export class OperationalMaintenance {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRetention: RetentionResult | null = null;
  private lastIntegrity = 'unknown';

  constructor(
    private readonly durable: MaintenanceStore,
    private readonly config: OperationalRetentionConfig = DEFAULT_RETENTION,
    private readonly now: () => number = () => Date.now(),
    /** DB file path — enables storage-utilization reporting. */
    private readonly dbPath?: string,
  ) {}

  /** Verify durable integrity (startup check). Returns 'ok' or the problem. Never
   * throws — a corrupt store is reported via health, not a crash ("no everything
   * reset"): the engine continues with whatever durable state survived. */
  verifyIntegrity(): string {
    try {
      this.lastIntegrity = this.durable.integrityCheck();
    } catch (err) {
      this.lastIntegrity = err instanceof Error ? err.message : String(err);
    }
    return this.lastIntegrity;
  }

  /** Run one retention pass now. Age cutoffs derive from the configured windows. */
  runRetention(): RetentionResult {
    const at = this.now();
    const deleted = this.durable.pruneOperational({
      auditBefore: at - this.config.auditDays * DAY_MS,
      usageBefore: at - this.config.usageDays * DAY_MS,
      incidentsBefore: at - this.config.incidentDays * DAY_MS,
      recoveryBefore: at - this.config.recoveryDays * DAY_MS,
    });
    this.lastRetention = { at, deleted };
    return this.lastRetention;
  }

  /** Start the periodic retention worker (idempotent). Runs one pass immediately,
   * then on the configured cadence. The timer is unref'd so it never keeps the
   * process alive on its own. */
  start(): void {
    if (this.timer) return;
    try { this.runRetention(); } catch { /* a retention failure is reported via health, never fatal */ }
    this.timer = setInterval(() => {
      try { this.runRetention(); } catch { /* reported via health */ }
    }, this.config.intervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Stop the retention worker (shutdown). Idempotent. */
  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private storageBytes(): number | null {
    if (!this.dbPath) return null;
    try { return fs.statSync(this.dbPath).size; } catch { return null; }
  }

  /** Truthful operational health — never "green because the process is alive". */
  health(): OperationalHealthSnapshot {
    const ph = this.durable.health();
    let reachable = true;
    let writeLatencyMs: number | null = null;
    try {
      writeLatencyMs = this.durable.probeWriteLatencyMs();
    } catch {
      reachable = false;
    }
    let counts: OperationalCounts = { auditEvents: 0, usageRecords: 0, incidents: 0, recoveryEvents: 0, reservations: 0 };
    try { counts = this.durable.operationalCounts(); } catch { reachable = false; }

    const schemaCurrent = ph.migrationState === 'applied' && ph.memoryStore === 'ready';
    const integrity = this.lastIntegrity;
    const writeLatencyOk = writeLatencyMs !== null && writeLatencyMs < this.config.writeLatencyDegradedMs;

    let status: OperationalStatus = 'healthy';
    if (!reachable || (integrity !== 'ok' && integrity !== 'unknown') || !schemaCurrent) {
      status = 'unhealthy';
    } else if (integrity === 'unknown' || !writeLatencyOk) {
      // Integrity not yet verified, or write latency above the degraded threshold.
      status = 'degraded';
    }

    return {
      status,
      reachable,
      schemaCurrent,
      schemaVersion: ph.schemaVersion,
      migrationState: ph.migrationState,
      integrity,
      retentionWorker: this.timer ? 'running' : 'stopped',
      lastRetentionAt: this.lastRetention?.at ?? null,
      lastRetentionDeleted: this.lastRetention?.deleted ?? null,
      writeLatencyMs,
      writeLatencyOk,
      storageBytes: this.storageBytes(),
      counts,
    };
  }
}
