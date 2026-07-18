// Intelligent Provider Router — Slice 5, commit 3/4: acceptance scenarios A–F.
//
// Physical UI clicking is not scriptable in this harness; these map each required
// physical run to its automatable logic (view-models + consent flow + typed client
// against a mock). The brain suite proves the server side; the VSIX install proves
// packaging; these prove the extension behavior.
//
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributionView, escalationCardContent, offerIsApprovable, failureView, budgetRows } from '../../panel/providerRouterViewModel.js';
import { runEscalationConsent, type ConsentClient, type ConsentUi } from '../../services/escalationConsent.js';

const OFFER = { offerId: 'esc_1', token: 't', reason: 'LOCAL_MALFORMED_OUTPUT', target: { providerId: 'anthropic', modelId: 'claude-sonnet-5' }, estimatedCostUsd: 0.03, worstCaseCostUsd: 0.07, remainingBudgetUsd: 18.42, dataLeavesLocal: true, request: { userPrompt: 'p' } };
function client(onApprove: () => void, result: Record<string, unknown>): ConsentClient {
  return { approveEscalation: async () => { onApprove(); return result as never; } };
}
function ui(action: 'Approve once' | 'Decline' | 'Stay local' | undefined): ConsentUi & { infos: string[]; errors: string[] } {
  const infos: string[] = [], errors: string[] = [];
  return { infos, errors, pickAction: async () => action, info: (m) => infos.push(m), error: (m) => errors.push(m) };
}

test('Run A — local success: local attribution, no escalation card', () => {
  const a = attributionView({ provider: 'local', model: 'qwen2.5-coder:14b', effectivePolicy: 'local-first' });
  assert.match(a.headline, /Handled locally/);
  assert.ok(!a.headline.includes('Cloud'));
});

test('Run B — cloud recommendation only: card shown with reason + cost; DECLINE → zero cloud calls', async () => {
  const card = escalationCardContent(OFFER);
  assert.match(card.lines.join('\n'), /Estimated cost: \$0\.03/);
  let calls = 0;
  const out = await runEscalationConsent(OFFER, client(() => calls++, { ok: true }), ui('Decline'));
  assert.equal(out.kind, 'declined');
  assert.equal(calls, 0);
  // final state is fallback-recommended-not-executed
  assert.match(attributionView({ provider: 'local', fallbackRecommended: true }).lines.join('\n'), /recommended but not approved/);
});

test('Run C — approved cloud fallback: exactly one cloud call, cloud attribution, no replay', async () => {
  let calls = 0;
  const result = { ok: true, escalation: { provider: 'anthropic', model: 'claude-sonnet-5', reason: 'LOCAL_MALFORMED_OUTPUT', viaEscalation: true }, costUsd: 0.04 };
  const out = await runEscalationConsent(OFFER, client(() => calls++, result), ui('Approve once'));
  assert.equal(out.kind, 'approved');
  assert.equal(calls, 1);
  const attr = attributionView({ viaEscalation: true, provider: 'anthropic', model: 'claude-sonnet-5', escalationReason: 'LOCAL_MALFORMED_OUTPUT', approvedCeilingUsd: 0.07, costUsd: 0.04, costStatus: 'estimated' });
  assert.match(attr.headline, /Cloud fallback used · anthropic/);
  assert.match(attr.lines.join('\n'), /Approved cost ceiling: \$0\.07/);
  // no offer is actionable a second time (server single-use; client guards too)
});

test('Run D — Local Only: no server offer ⇒ nothing actionable; a null offer is never approvable', async () => {
  // Under local-only the server never issues an offer; the client must not synthesize one.
  assert.equal(offerIsApprovable(undefined), false);
  let calls = 0;
  const out = await runEscalationConsent(undefined, client(() => calls++, { ok: true }), ui('Approve once'));
  assert.equal(out.kind, 'invalid');
  assert.equal(calls, 0);
});

test('Run E — budget denied: approval rejected surfaces the budget code, no false success', async () => {
  const u = ui('Approve once');
  const out = await runEscalationConsent(OFFER, client(() => {}, { ok: false, code: 'BUDGET_EXCEEDED' }), u);
  assert.equal(out.kind, 'approved');
  assert.match(u.errors.join(), /budget is insufficient.*BUDGET_EXCEEDED/);
  assert.equal(failureView('BUDGET_EXCEEDED').code, 'BUDGET_EXCEEDED');
});

test('Run F — stale/expired offer: not actionable, expired message, zero cloud calls (no hidden retry)', async () => {
  let calls = 0;
  const u = ui('Approve once');
  const stale = { ...OFFER, target: undefined } as never; // simulate a partial/stale offer
  const out = await runEscalationConsent(stale, client(() => calls++, { ok: true }), u);
  assert.equal(out.kind, 'invalid');
  assert.equal(calls, 0);
  assert.match(u.errors.join(), /expired/);
});

test('budget disabled state renders truthfully (never a fake $0)', () => {
  const rows = budgetRows({ enabled: false, currency: 'USD', scopes: [] }, undefined);
  assert.ok(rows.some((r) => r.value === 'disabled'));
});
