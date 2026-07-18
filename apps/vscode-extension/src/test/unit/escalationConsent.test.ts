// Intelligent Provider Router — Slice 5, commit 2: consent flow (zero silent cloud).
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEscalationConsent, type ConsentUi, type ConsentClient } from '../../services/escalationConsent.js';

const OFFER = { offerId: 'esc_1', token: 't', reason: 'LOCAL_TIMEOUT', target: { providerId: 'anthropic', modelId: 'claude-sonnet-5' }, estimatedCostUsd: 0.03, worstCaseCostUsd: 0.07, remainingBudgetUsd: 20, dataLeavesLocal: true, request: { userPrompt: 'p' } };

function client(onApprove: () => void, result: Record<string, unknown>): ConsentClient {
  return { approveEscalation: async () => { onApprove(); return result as never; } };
}
function ui(action: 'Approve once' | 'Decline' | 'Stay local' | undefined): ConsentUi & { infos: string[]; errors: string[] } {
  const infos: string[] = [], errors: string[] = [];
  return { infos, errors, pickAction: async () => action, info: (m) => infos.push(m), error: (m) => errors.push(m) };
}

test('Approve once → exactly one cloud call, attributed result', async () => {
  let calls = 0;
  const u = ui('Approve once');
  const out = await runEscalationConsent(OFFER, client(() => calls++, { ok: true, escalation: { provider: 'anthropic', model: 'claude-sonnet-5', reason: 'LOCAL_TIMEOUT', viaEscalation: true } }), u);
  assert.equal(out.kind, 'approved');
  assert.equal(calls, 1);
  assert.match(u.infos.join(), /Cloud fallback used: anthropic/);
});

test('Decline → ZERO cloud calls', async () => {
  let calls = 0;
  const out = await runEscalationConsent(OFFER, client(() => calls++, { ok: true }), ui('Decline'));
  assert.equal(out.kind, 'declined');
  assert.equal(calls, 0);
});

test('Stay local / dismissed → ZERO cloud calls', async () => {
  let calls = 0;
  assert.equal((await runEscalationConsent(OFFER, client(() => calls++, { ok: true }), ui('Stay local'))).kind, 'declined');
  assert.equal((await runEscalationConsent(OFFER, client(() => calls++, { ok: true }), ui(undefined))).kind, 'declined');
  assert.equal(calls, 0);
});

test('a malformed / expired offer is not actionable → ZERO cloud calls, expired message', async () => {
  let calls = 0;
  const u = ui('Approve once');
  const out = await runEscalationConsent({ ...OFFER, target: undefined } as never, client(() => calls++, { ok: true }), u);
  assert.equal(out.kind, 'invalid');
  assert.equal(calls, 0);
  assert.match(u.errors.join(), /expired/);
});

test('an approval rejected by the server (e.g. BUDGET_EXCEEDED) surfaces the code, no false success', async () => {
  const u = ui('Approve once');
  const out = await runEscalationConsent(OFFER, client(() => {}, { ok: false, code: 'BUDGET_EXCEEDED' }), u);
  assert.equal(out.kind, 'approved');
  assert.match(u.errors.join(), /budget is insufficient.*BUDGET_EXCEEDED/);
});
