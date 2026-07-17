/**
 * MigraAI Engine — tool approval store.
 *
 * Engine-owned, single-use approval tokens for MUTATING capability execution.
 * This moves the approval guarantees the extension proved for pilot-api UNDER the
 * new tool boundary, for locally-executed tools:
 *  - binding: an approval is bound to exactly (tool, inputHash); executing with a
 *    different tool/input is refused.
 *  - single-use: consuming transitions PENDING → CONSUMED; a second consume is a
 *    replay and is refused (INVALID_STATE).
 *  - idempotency: minting twice for the same (tool, inputHash, requestId) returns
 *    the SAME pending approval, so a retried mint never creates a second token.
 *  - expiry: approvals lapse after a TTL and are then unusable.
 *
 * In-memory + bounded — a local single-process engine. A hosted deployment can
 * swap this for a shared store without changing the route contract.
 */

import { createHash } from 'node:crypto';
import { StoreHealth, shortId, safeSink, NOOP_TELEMETRY, type TelemetrySink, type StoreHealthSnapshot } from './storeTelemetry.js';

export type ApprovalState = 'PENDING' | 'CONSUMED' | 'EXPIRED';

export interface ApprovalRecord {
  id: string;
  tool: string;
  inputHash: string;
  requestId: string;
  state: ApprovalState;
  createdAt: number;
  expiresAt: number;
}

export type ConsumeResult =
  | { ok: true; record: ApprovalRecord }
  | { ok: false; reason: 'unknown' | 'consumed' | 'expired' | 'mismatch' };

const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_RECORDS = 500;

/** Instrumented (Slice 2): every mint/consume/expiry/eviction emits ONE
 * metadata-only telemetry event (never the token or the raw input hash body),
 * and health() returns a truthful snapshot. */
export class ToolApprovalStore {
  private readonly byId = new Map<string, ApprovalRecord>();
  private readonly telemetry: TelemetrySink;
  private readonly healthTracker: StoreHealth;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = defaultId,
    private readonly ttlMs = DEFAULT_TTL_MS,
    telemetry: TelemetrySink = NOOP_TELEMETRY,
  ) {
    this.telemetry = safeSink(telemetry);
    this.healthTracker = new StoreHealth('approval', MAX_RECORDS, now);
  }

  private emit(event: Parameters<TelemetrySink>[0]['event'], fields: Record<string, unknown>, correlationId?: string): void {
    this.telemetry({ event, at: this.now(), correlationId, fields });
  }

  /** Mint (or idempotently return) a PENDING approval bound to (tool, inputHash).
   * A repeat mint with the same requestId returns the existing pending token. */
  mint(params: { tool: string; inputHash: string; requestId: string; correlationId?: string }): ApprovalRecord {
    this.sweep(params.correlationId);
    for (const rec of this.byId.values()) {
      if (
        rec.state === 'PENDING' &&
        rec.tool === params.tool &&
        rec.inputHash === params.inputHash &&
        rec.requestId === params.requestId
      ) {
        return rec; // idempotent — no second mint event
      }
    }
    const t = this.now();
    const record: ApprovalRecord = {
      id: this.mkId(),
      tool: params.tool,
      inputHash: params.inputHash,
      requestId: params.requestId,
      state: 'PENDING',
      createdAt: t,
      expiresAt: t + this.ttlMs,
    };
    this.byId.set(record.id, record);
    if (this.byId.size > MAX_RECORDS) this.evictForCapacity(params.correlationId);
    // Redaction: log the binding reference (opaque) + tool — never the token id.
    this.healthTracker.onCreated();
    this.emit('approval.minted', { tool: params.tool, binding: shortId(params.inputHash), createdAt: t, expiresAt: t + this.ttlMs, storeSize: this.byId.size, capacity: MAX_RECORDS }, params.correlationId);
    return record;
  }

  /** Consume an approval for exactly (tool, inputHash). Single-use: a second
   * consume, a mismatched binding, an unknown id, or an expired token is refused. */
  consume(id: string, binding: { tool: string; inputHash: string; correlationId?: string }): ConsumeResult {
    const correlationId = binding.correlationId;
    const rec = this.byId.get(id);
    if (!rec) {
      this.emit('approval.unknown', { tool: binding.tool }, correlationId);
      return { ok: false, reason: 'unknown' };
    }
    if (rec.state === 'CONSUMED') {
      this.healthTracker.onRejected();
      this.emit('approval.replayed', { tool: rec.tool, binding: shortId(rec.inputHash), ageMs: this.now() - rec.createdAt }, correlationId);
      return { ok: false, reason: 'consumed' };
    }
    if (rec.state === 'EXPIRED' || rec.expiresAt <= this.now()) {
      rec.state = 'EXPIRED';
      this.healthTracker.onExpired();
      this.emit('approval.expired', { tool: rec.tool, binding: shortId(rec.inputHash), ageMs: this.now() - rec.createdAt }, correlationId);
      return { ok: false, reason: 'expired' };
    }
    if (rec.tool !== binding.tool || rec.inputHash !== binding.inputHash) {
      this.healthTracker.onRejected();
      this.emit('approval.rejected', { tool: rec.tool, reason: 'mismatch' }, correlationId);
      return { ok: false, reason: 'mismatch' };
    }
    rec.state = 'CONSUMED';
    this.healthTracker.onConsumed();
    this.emit('approval.consumed', { tool: rec.tool, binding: shortId(rec.inputHash), ageMs: this.now() - rec.createdAt, storeSize: this.byId.size }, correlationId);
    return { ok: true, record: rec };
  }

  get(id: string): ApprovalRecord | undefined {
    return this.byId.get(id);
  }

  /** Truthful health snapshot (sweeps expired first). */
  health(): StoreHealthSnapshot {
    const started = this.now();
    this.sweep();
    // Drop dead (CONSUMED/EXPIRED) records so current_entries reflects live load.
    let removed = 0;
    for (const [k, rec] of [...this.byId.entries()]) {
      if (rec.state !== 'PENDING') {
        this.byId.delete(k);
        removed += 1;
      }
    }
    this.healthTracker.onCleanup(this.now() - started);
    const nowT = this.now();
    let oldestAge: number | null = null;
    let nextExp: number | null = null;
    for (const rec of this.byId.values()) {
      oldestAge = oldestAge === null ? nowT - rec.createdAt : Math.max(oldestAge, nowT - rec.createdAt);
      nextExp = nextExp === null ? rec.expiresAt - nowT : Math.min(nextExp, rec.expiresAt - nowT);
    }
    return this.healthTracker.snapshot(this.byId.size, oldestAge, nextExp);
  }

  /** Deterministic capacity policy: drop DEAD (expired/consumed) records first;
   * only if still over capacity, evict the oldest PENDING — explicit + counted. */
  private evictForCapacity(correlationId?: string): void {
    const dead = [...this.byId.entries()].filter(([, r]) => r.state !== 'PENDING').map(([k]) => k);
    if (dead.length) {
      for (const k of dead) this.byId.delete(k);
      this.healthTracker.onEvicted(dead.length);
      this.emit('approval.expired', { reason: 'capacity_dead', removed: dead.length, storeSize: this.byId.size }, correlationId);
    }
    if (this.byId.size > MAX_RECORDS) {
      const oldest = this.byId.keys().next().value;
      if (oldest) {
        this.byId.delete(oldest);
        this.healthTracker.onEvicted(1);
        this.emit('approval.rejected', { reason: 'capacity_evicted', removed: 1, storeSize: this.byId.size }, correlationId);
      }
    }
  }

  private sweep(correlationId?: string): void {
    const t = this.now();
    let expired = 0;
    for (const rec of this.byId.values()) {
      if (rec.state === 'PENDING' && rec.expiresAt <= t) {
        rec.state = 'EXPIRED';
        expired += 1;
      }
    }
    if (expired) {
      this.healthTracker.onExpired(expired);
      this.emit('approval.expired', { reason: 'sweep', removed: expired, storeSize: this.byId.size }, correlationId);
    }
  }
}

function defaultId(): string {
  // Non-guessable enough for a local single-use token; not a secret.
  return `appr_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 28);
}

/** Stable structural hash of a tool input, so an approval binds to the exact
 * request it previewed. Key order is normalized, then SHA-256 — an approval
 * token is a security binding, so a collision must be cryptographically
 * infeasible (a 32-bit hash was substitutable). */
export function hashInput(input: unknown): string {
  return createHash('sha256').update(stableStringify(input), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
