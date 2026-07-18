// Intelligent Provider Router — Slice 4: append-only usage ledger.
//
// METADATA ONLY. It records who/what/how-much for every provider execution — never
// prompts, completions, source, tool output, diffs, credentials, tokens (secrets),
// consent tokens, or raw paths. Append-only + bounded queries. Every string field
// is run through the canonical redactor as defense in depth.
//
// © MigraTeck LLC.

import { randomUUID } from 'node:crypto';
import { redactString } from '../../redaction.js';

export type ExecutionMode = 'engineer' | 'chat' | 'escalation';
export type LocalOrCloud = 'local' | 'cloud';
export type CostStatus = 'actual' | 'estimated' | 'unknown';

export interface UsageRecord {
  usageId: string;
  executionCorrelationId: string;
  providerId: string;
  modelId: string;
  executionMode: ExecutionMode;
  policy: string;
  localOrCloud: LocalOrCloud;
  timestamp: number;
  outcome: string;
  escalationReason?: string;
  consentOrOfferId?: string;
  reservationId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costStatus: CostStatus;
  // cloud reconciliation
  providerReportedCostUsd?: number;
  calculatedCostUsd?: number;
  costDiscrepancyUsd?: number;
  billingRequestId?: string;
  // local savings (never claims local is literally free)
  equivalentCloudCostUsd?: number;
  estimatedSavingsUsd?: number;
  localCostStatus?: 'estimated' | 'unknown';
}

export interface UsageQuery {
  from?: number;
  to?: number;
  providerId?: string;
  modelId?: string;
  localOrCloud?: LocalOrCloud;
  correlationId?: string;
  outcome?: string;
  limit?: number;
  offset?: number;
}

/** Fields that would be a category error to ever store — hard-dropped on append. */
const FORBIDDEN_FIELDS = new Set(['prompt', 'response', 'content', 'source', 'code', 'diff', 'apiKey', 'token', 'approvalToken', 'consentToken', 'rootPath', 'path', 'output', 'stdout', 'stderr']);
const MAX_RECORDS = 20_000;

export type UsageInput = Omit<UsageRecord, 'usageId' | 'timestamp'> & { usageId?: string; timestamp?: number };

export class UsageLedger {
  private readonly records: UsageRecord[] = [];
  private writer: ((r: UsageRecord) => void) | null = null;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = randomUUID,
  ) {}

  /** Attach a durable writer (records are already metadata-only + redacted). A
   * writer failure never blocks the in-memory append (accounting is not weakened
   * by a telemetry/persistence failure). */
  setWriter(writer: ((r: UsageRecord) => void) | null): void {
    this.writer = writer;
  }

  /** Restore recent records from durable storage on startup so summary()/query()
   * reflect history across a restart. Records are already redacted; the durable
   * writer is NOT invoked (this is a load, not a new append). Newest-last input. */
  hydrate(records: UsageRecord[]): void {
    for (const r of records) this.records.push(r);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
  }

  /** Append a metadata-only usage record. Forbidden keys are dropped; every string
   * is redacted. Returns the stored record. */
  append(input: UsageInput): UsageRecord {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (FORBIDDEN_FIELDS.has(k)) continue;
      clean[k] = typeof v === 'string' ? redactString(v, { redactPaths: true }).value.slice(0, 200) : v;
    }
    const record = {
      ...(clean as unknown as UsageRecord),
      usageId: input.usageId ?? `use_${this.mkId()}`,
      timestamp: input.timestamp ?? this.now(),
    };
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    if (this.writer) { try { this.writer(record); } catch { /* durable failure never weakens accounting */ } }
    return record;
  }

  /** Bounded query. Newest-first; capped page size. */
  query(q: UsageQuery = {}): UsageRecord[] {
    const limit = Math.max(1, Math.min(q.limit ?? 100, 1000));
    const offset = Math.max(0, q.offset ?? 0);
    const out = this.records
      .filter((r) =>
        (q.from === undefined || r.timestamp >= q.from) &&
        (q.to === undefined || r.timestamp <= q.to) &&
        (q.providerId === undefined || r.providerId === q.providerId) &&
        (q.modelId === undefined || r.modelId === q.modelId) &&
        (q.localOrCloud === undefined || r.localOrCloud === q.localOrCloud) &&
        (q.correlationId === undefined || r.executionCorrelationId === q.correlationId) &&
        (q.outcome === undefined || r.outcome === q.outcome),
      )
      .reverse();
    return out.slice(offset, offset + limit);
  }

  byCorrelation(correlationId: string): UsageRecord[] {
    return this.records.filter((r) => r.executionCorrelationId === correlationId);
  }

  /** Local-vs-cloud + per-provider/model rollup (metadata only). */
  summary(): {
    totalRecords: number;
    cloud: { count: number; costUsd: number };
    local: { count: number; estimatedSavingsUsd: number; savingsStatus: 'estimated' | 'unknown' };
    byProvider: Record<string, { count: number; costUsd: number }>;
  } {
    const byProvider: Record<string, { count: number; costUsd: number }> = {};
    let cloudCount = 0, cloudCost = 0, localCount = 0, savings = 0;
    let anyUnknownLocal = false;
    for (const r of this.records) {
      const p = (byProvider[r.providerId] ??= { count: 0, costUsd: 0 });
      p.count += 1;
      p.costUsd = round(p.costUsd + (r.costUsd ?? 0));
      if (r.localOrCloud === 'cloud') { cloudCount += 1; cloudCost += r.costUsd ?? 0; }
      else { localCount += 1; savings += r.estimatedSavingsUsd ?? 0; if (r.localCostStatus === 'unknown' || r.localCostStatus === undefined) anyUnknownLocal = true; }
    }
    return {
      totalRecords: this.records.length,
      cloud: { count: cloudCount, costUsd: round(cloudCost) },
      local: { count: localCount, estimatedSavingsUsd: round(savings), savingsStatus: anyUnknownLocal ? 'unknown' : 'estimated' },
      byProvider,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
