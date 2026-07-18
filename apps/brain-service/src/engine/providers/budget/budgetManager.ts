// Intelligent Provider Router — Slice 4: budget scopes, reservation, reconciliation.
//
// Server-authoritative, FAIL-CLOSED budget enforcement. No paid cloud request may
// begin without a successful reservation. Reservations are atomic: the check +
// increment run synchronously (no await between them), so two concurrent requests
// can never both spend the same remaining budget. Reserved funds count against
// remaining; failed calls release; actual usage reconciles; replays/retries need a
// fresh reservation; expired reservations release audibly.
//
// © MigraTeck LLC.

import { randomUUID } from 'node:crypto';
import { auditStore } from '../../auditLog.js';
import type { CostEstimate } from './costEstimation.js';

export type BudgetScopeKind = 'per_request' | 'daily' | 'monthly' | 'provider' | 'model' | 'workspace_or_tenant';

export interface BudgetScope {
  kind: BudgetScopeKind;
  /** Scope key: 'global' for per_request/daily/monthly; providerId/modelId/tenant otherwise. */
  key: string;
  enabled: boolean;
  currency: 'USD';
  hardLimitUsd: number;
  /** Fraction 0..1 at which a warning is emitted. */
  warningThreshold: number;
  /** Rolling-window length (ms) for daily/monthly; undefined = no reset. */
  periodMs?: number;
  periodStart: number;
  spentUsd: number;
  reservedUsd: number;
}

export type BudgetFailureCode =
  | 'BUDGET_DISABLED'
  | 'BUDGET_NOT_CONFIGURED'
  | 'BUDGET_EXCEEDED'
  | 'REQUEST_COST_LIMIT_EXCEEDED'
  | 'PROVIDER_COST_LIMIT_EXCEEDED'
  | 'COST_ESTIMATE_UNAVAILABLE'
  | 'RESERVATION_CONFLICT';

export interface Reservation {
  reservationId: string;
  amountUsd: number;
  scopeIds: string[];
  correlationId: string;
  providerId: string;
  modelId: string;
  createdAt: number;
  expiresAt: number;
  status: 'active' | 'consumed' | 'released' | 'expired';
}

export interface ReserveContext {
  correlationId: string;
  providerId: string;
  modelId: string;
  tenant?: string;
  estimate: CostEstimate;
}

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; code: BudgetFailureCode; detail: string };

export interface ReconcileResult {
  ok: boolean;
  actualUsd: number;
  reservedUsd: number;
  overrun: boolean;
}

const RESERVATION_TTL_MS = 10 * 60_000;

function scopeId(kind: BudgetScopeKind, key: string): string {
  return `${kind}:${key}`;
}

export class BudgetManager {
  private readonly scopes = new Map<string, BudgetScope>();
  private readonly reservations = new Map<string, Reservation>();

  constructor(
    private readonly enabled: boolean,
    scopes: BudgetScope[] = [],
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = randomUUID,
    private readonly ttlMs = RESERVATION_TTL_MS,
  ) {
    for (const s of scopes) this.scopes.set(scopeId(s.kind, s.key), s);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Roll a period window forward if elapsed (resets spent + reserved). */
  private roll(s: BudgetScope): void {
    if (!s.periodMs) return;
    const now = this.now();
    while (now >= s.periodStart + s.periodMs) {
      s.periodStart += s.periodMs;
      s.spentUsd = 0;
      s.reservedUsd = 0;
    }
  }

  private remaining(s: BudgetScope): number {
    this.roll(s);
    return round(s.hardLimitUsd - s.spentUsd - s.reservedUsd);
  }

  /** The accumulating scopes that apply to a given reservation context. */
  private applicable(ctx: ReserveContext): BudgetScope[] {
    const ids = [
      scopeId('daily', 'global'),
      scopeId('monthly', 'global'),
      scopeId('provider', ctx.providerId),
      scopeId('model', ctx.modelId),
      ...(ctx.tenant ? [scopeId('workspace_or_tenant', ctx.tenant)] : []),
    ];
    return ids.map((id) => this.scopes.get(id)).filter((s): s is BudgetScope => !!s && s.enabled);
  }

  /** ATOMIC reserve. The check + increment below run with NO await between them —
   * that synchronous critical section is what prevents concurrent overspend. */
  reserve(ctx: ReserveContext): ReserveResult {
    const deny = (code: BudgetFailureCode, detail: string): ReserveResult => {
      auditStore.append({ correlationId: ctx.correlationId, type: 'budget.reservation_denied', component: 'budget', outcome: code, fields: { provider: ctx.providerId, model: ctx.modelId, code } });
      return { ok: false, code, detail };
    };

    if (!this.enabled) return deny('BUDGET_DISABLED', 'budget enforcement is disabled — paid cloud is not permitted');
    if (ctx.estimate.costUnavailable) {
      auditStore.append({ correlationId: ctx.correlationId, type: 'budget.pricing_unknown', component: 'budget', fields: { provider: ctx.providerId, model: ctx.modelId } });
      return deny('COST_ESTIMATE_UNAVAILABLE', 'no trustworthy price for this provider/model');
    }
    const cost = ctx.estimate.worstCaseCostUsd;

    // Per-request ceiling (does not accumulate).
    const perReq = this.scopes.get(scopeId('per_request', 'global'));
    if (perReq?.enabled && cost > perReq.hardLimitUsd) {
      return deny('REQUEST_COST_LIMIT_EXCEEDED', `worst-case $${cost} exceeds per-request limit $${perReq.hardLimitUsd}`);
    }

    const accumulating = this.applicable(ctx);
    if (accumulating.length === 0) return deny('BUDGET_NOT_CONFIGURED', 'no applicable budget scope is configured');

    // Check ALL scopes first (no mutation yet)…
    for (const s of accumulating) {
      if (cost > this.remaining(s)) {
        return deny(s.kind === 'provider' ? 'PROVIDER_COST_LIMIT_EXCEEDED' : 'BUDGET_EXCEEDED', `worst-case $${cost} exceeds remaining $${this.remaining(s)} on ${s.kind}`);
      }
    }
    // …then increment reserved on every scope (synchronous → atomic).
    for (const s of accumulating) {
      s.reservedUsd = round(s.reservedUsd + cost);
      const used = (s.spentUsd + s.reservedUsd) / s.hardLimitUsd;
      if (used >= s.warningThreshold) auditStore.append({ correlationId: ctx.correlationId, type: 'budget.warning_threshold_reached', component: 'budget', fields: { scope: s.kind, usedPercent: Math.round(used * 100) } });
      if (used >= 1) auditStore.append({ correlationId: ctx.correlationId, type: 'budget.hard_limit_reached', component: 'budget', fields: { scope: s.kind } });
    }

    const reservation: Reservation = {
      reservationId: `rsv_${this.mkId()}`,
      amountUsd: cost,
      scopeIds: accumulating.map((s) => scopeId(s.kind, s.key)),
      correlationId: ctx.correlationId,
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      status: 'active',
    };
    this.reservations.set(reservation.reservationId, reservation);
    auditStore.append({ correlationId: ctx.correlationId, type: 'budget.reservation_created', component: 'budget', fields: { provider: ctx.providerId, model: ctx.modelId, amountUsd: cost } });
    return { ok: true, reservation };
  }

  /** Consume a reservation with the ACTUAL cost. Moves reserved → spent; actual is
   * floored at 0; an overrun is recorded truthfully. Single-use. */
  consume(reservationId: string, actualCostUsd: number): ReconcileResult | { ok: false; code: 'RESERVATION_CONFLICT' } {
    const r = this.reservations.get(reservationId);
    this.releaseExpired();
    if (!r || r.status !== 'active') return { ok: false, code: 'RESERVATION_CONFLICT' };
    const actual = Math.max(0, round(actualCostUsd));
    for (const id of r.scopeIds) {
      const s = this.scopes.get(id);
      if (!s) continue;
      s.reservedUsd = round(Math.max(0, s.reservedUsd - r.amountUsd));
      s.spentUsd = round(s.spentUsd + actual);
    }
    r.status = 'consumed';
    const overrun = actual > r.amountUsd;
    auditStore.append({ correlationId: r.correlationId, type: 'budget.reservation_consumed', component: 'budget', fields: { provider: r.providerId, reservedUsd: r.amountUsd, actualUsd: actual } });
    auditStore.append({ correlationId: r.correlationId, type: 'budget.reconciled', component: 'budget', outcome: overrun ? 'overrun' : 'ok', fields: { reservedUsd: r.amountUsd, actualUsd: actual } });
    if (overrun) auditStore.append({ correlationId: r.correlationId, type: 'budget.overrun_detected', component: 'budget', outcome: 'high', fields: { reservedUsd: r.amountUsd, actualUsd: actual } });
    return { ok: true, actualUsd: actual, reservedUsd: r.amountUsd, overrun };
  }

  /** Release an unused reservation (failed provider call). Single-use. */
  release(reservationId: string): boolean {
    const r = this.reservations.get(reservationId);
    if (!r || r.status !== 'active') return false;
    for (const id of r.scopeIds) {
      const s = this.scopes.get(id);
      if (s) s.reservedUsd = round(Math.max(0, s.reservedUsd - r.amountUsd));
    }
    r.status = 'released';
    auditStore.append({ correlationId: r.correlationId, type: 'budget.reservation_released', component: 'budget', fields: { provider: r.providerId, releasedUsd: r.amountUsd } });
    return true;
  }

  /** Auto-release expired active reservations (audibly). */
  releaseExpired(): number {
    const now = this.now();
    let n = 0;
    for (const r of this.reservations.values()) {
      if (r.status === 'active' && now > r.expiresAt) {
        for (const id of r.scopeIds) {
          const s = this.scopes.get(id);
          if (s) s.reservedUsd = round(Math.max(0, s.reservedUsd - r.amountUsd));
        }
        r.status = 'expired';
        auditStore.append({ correlationId: r.correlationId, type: 'budget.reservation_released', component: 'budget', outcome: 'expired', fields: { provider: r.providerId, releasedUsd: r.amountUsd } });
        n += 1;
      }
    }
    return n;
  }

  getReservation(id: string): Reservation | undefined {
    return this.reservations.get(id);
  }

  /** Safe status snapshot for the budget API (no secrets; metadata only). */
  status(): Array<{ kind: BudgetScopeKind; key: string; enabled: boolean; hardLimitUsd: number; spentUsd: number; reservedUsd: number; remainingUsd: number; warningThreshold: number }> {
    return [...this.scopes.values()].map((s) => ({ kind: s.kind, key: s.key, enabled: s.enabled, hardLimitUsd: s.hardLimitUsd, spentUsd: s.spentUsd, reservedUsd: s.reservedUsd, remainingUsd: this.remaining(s), warningThreshold: s.warningThreshold }));
  }
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
