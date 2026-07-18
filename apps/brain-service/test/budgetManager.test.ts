// Intelligent Provider Router — Slice 4, commit 2: budget reservation + reconciliation.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BudgetManager, type BudgetScope, type ReserveContext } from '../src/engine/providers/budget/budgetManager.js';
import type { CostEstimate } from '../src/engine/providers/budget/costEstimation.js';

function scope(kind: BudgetScope['kind'], key: string, hardLimitUsd: number, over: Partial<BudgetScope> = {}): BudgetScope {
  return { kind, key, enabled: true, currency: 'USD', hardLimitUsd, warningThreshold: 0.8, periodStart: 0, spentUsd: 0, reservedUsd: 0, ...over };
}
function est(worstCaseCostUsd: number, over: Partial<CostEstimate> = {}): CostEstimate {
  return { providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedInputTokens: 100, maximumOutputTokens: 800, estimatedCostUsd: worstCaseCostUsd, worstCaseCostUsd, pricingStatus: 'configured', costUnavailable: false, ...over };
}
function ctx(worstCase: number, over: Partial<ReserveContext> = {}): ReserveContext {
  return { correlationId: 'c', providerId: 'anthropic', modelId: 'claude-sonnet-5', estimate: est(worstCase), ...over };
}
let idn = 0;
const ids = () => `x${idn++}`;

test('disabled budget → BUDGET_DISABLED (fail closed)', () => {
  const m = new BudgetManager(false, [scope('monthly', 'global', 100)], () => 0, ids);
  const r = m.reserve(ctx(0.01));
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, 'BUDGET_DISABLED');
});

test('enabled but no applicable scope → BUDGET_NOT_CONFIGURED', () => {
  const m = new BudgetManager(true, [], () => 0, ids);
  assert.equal((m.reserve(ctx(0.01)) as { code: string }).code, 'BUDGET_NOT_CONFIGURED');
});

test('unknown pricing → COST_ESTIMATE_UNAVAILABLE', () => {
  const m = new BudgetManager(true, [scope('monthly', 'global', 100)], () => 0, ids);
  const r = m.reserve(ctx(0.01, { estimate: est(0.01, { costUnavailable: true, pricingStatus: 'unknown' }) }));
  assert.equal((r as { code: string }).code, 'COST_ESTIMATE_UNAVAILABLE');
});

test('per-request limit fails closed', () => {
  const m = new BudgetManager(true, [scope('per_request', 'global', 0.5), scope('monthly', 'global', 100)], () => 0, ids);
  assert.equal((m.reserve(ctx(0.6)) as { code: string }).code, 'REQUEST_COST_LIMIT_EXCEEDED');
  assert.equal(m.reserve(ctx(0.4)).ok, true);
});

test('daily / monthly / provider limits each fail closed', () => {
  const daily = new BudgetManager(true, [scope('daily', 'global', 1)], () => 0, ids);
  assert.equal((daily.reserve(ctx(1.5)) as { code: string }).code, 'BUDGET_EXCEEDED');
  const monthly = new BudgetManager(true, [scope('monthly', 'global', 1)], () => 0, ids);
  assert.equal((monthly.reserve(ctx(1.5)) as { code: string }).code, 'BUDGET_EXCEEDED');
  const prov = new BudgetManager(true, [scope('provider', 'anthropic', 1)], () => 0, ids);
  assert.equal((prov.reserve(ctx(1.5)) as { code: string }).code, 'PROVIDER_COST_LIMIT_EXCEEDED');
});

test('reserved funds count against remaining — concurrency cannot overspend', () => {
  const m = new BudgetManager(true, [scope('monthly', 'global', 1)], () => 0, ids);
  const a = m.reserve(ctx(0.7));
  assert.equal(a.ok, true);
  // Only $0.30 remains; a second $0.70 request must be denied.
  const b = m.reserve(ctx(0.7));
  assert.equal(b.ok, false);
  assert.equal((b as { code: string }).code, 'BUDGET_EXCEEDED');
});

test('failed provider call releases the reservation back to remaining', () => {
  const m = new BudgetManager(true, [scope('monthly', 'global', 1)], () => 0, ids);
  const a = m.reserve(ctx(0.7));
  assert.equal(m.release((a as { reservation: { reservationId: string } }).reservation.reservationId), true);
  // full budget available again
  assert.equal(m.reserve(ctx(0.9)).ok, true);
});

test('consume reconciles actual (below reservation frees the difference; above is surfaced)', () => {
  const m = new BudgetManager(true, [scope('monthly', 'global', 1)], () => 0, ids);
  const r = m.reserve(ctx(0.5)) as { ok: true; reservation: { reservationId: string } };
  const recon = m.consume(r.reservation.reservationId, 0.2);
  assert.equal((recon as { actualUsd: number }).actualUsd, 0.2);
  assert.equal((recon as { overrun: boolean }).overrun, false);
  // spent 0.2, reserved back to 0 → $0.80 remains; reserve+release to prove it, no dangling hold
  const probe = m.reserve(ctx(0.8)) as { ok: true; reservation: { reservationId: string } };
  assert.equal(probe.ok, true);
  m.release(probe.reservation.reservationId);
  // an overrun is surfaced honestly
  const r2 = m.reserve(ctx(0.05)) as { ok: true; reservation: { reservationId: string } };
  const over = m.consume(r2.reservation.reservationId, 0.5);
  assert.equal((over as { overrun: boolean }).overrun, true);
});

test('negative actual cannot reduce recorded cost below zero', () => {
  const m = new BudgetManager(true, [scope('monthly', 'global', 1)], () => 0, ids);
  const r = m.reserve(ctx(0.5)) as { ok: true; reservation: { reservationId: string } };
  const recon = m.consume(r.reservation.reservationId, -3) as { actualUsd: number };
  assert.equal(recon.actualUsd, 0);
});

test('replay / retry: a consumed or released reservation cannot be reused (RESERVATION_CONFLICT)', () => {
  const m = new BudgetManager(true, [scope('monthly', 'global', 1)], () => 0, ids);
  const r = m.reserve(ctx(0.5)) as { ok: true; reservation: { reservationId: string } };
  m.consume(r.reservation.reservationId, 0.5);
  assert.deepEqual(m.consume(r.reservation.reservationId, 0.5), { ok: false, code: 'RESERVATION_CONFLICT' });
  assert.equal(m.release(r.reservation.reservationId), false);
});

test('expired reservations release automatically', () => {
  let t = 0;
  const m = new BudgetManager(true, [scope('monthly', 'global', 1)], () => t, ids, 1000);
  const r = m.reserve(ctx(0.9)) as { ok: true; reservation: { reservationId: string } };
  t = 5000; // past TTL
  assert.equal(m.releaseExpired(), 1);
  assert.equal(m.getReservation(r.reservation.reservationId)!.status, 'expired');
  assert.equal(m.reserve(ctx(0.9)).ok, true); // budget freed
});

test('period rollover resets spent + reserved (daily window)', () => {
  let t = 0;
  const m = new BudgetManager(true, [scope('daily', 'global', 1, { periodMs: 1000 })], () => t, ids);
  const r = m.reserve(ctx(0.9)) as { ok: true; reservation: { reservationId: string } };
  m.consume(r.reservation.reservationId, 0.9);
  assert.equal((m.reserve(ctx(0.5)) as { code: string }).code, 'BUDGET_EXCEEDED'); // only 0.1 left
  t = 1500; // next window
  assert.equal(m.reserve(ctx(0.9)).ok, true); // reset
});
