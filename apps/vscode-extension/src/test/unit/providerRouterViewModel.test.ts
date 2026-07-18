// Intelligent Provider Router — Slice 5, commit 2: escalation / attribution / failure VM.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  escalationCardContent,
  offerIsApprovable,
  attributionView,
  failureView,
  escalationReasonText,
  shortCorrelation,
  OFFER_EXPIRED_MESSAGE,
} from '../../panel/providerRouterViewModel.js';

test('escalation card shows reason/provider/model/data-scope/est+worst cost/remaining budget', () => {
  const card = escalationCardContent({ offerId: 'esc_1', token: 't', reason: 'LOCAL_MALFORMED_OUTPUT', target: { providerId: 'anthropic', modelId: 'claude-sonnet-5' }, estimatedCostUsd: 0.03, worstCaseCostUsd: 0.07, remainingBudgetUsd: 18.42, dataLeavesLocal: true, request: {} });
  assert.equal(card.title, 'Cloud fallback requested');
  assert.deepEqual(card.actions, ['Approve once', 'Decline', 'Stay local']);
  const t = card.lines.join('\n');
  assert.match(t, /malformed or empty output/);
  assert.match(t, /Provider: anthropic/);
  assert.match(t, /Model: claude-sonnet-5/);
  assert.match(t, /current prompt and selected workspace context/);
  assert.match(t, /Estimated cost: \$0\.03 \(estimated\)/);
  assert.match(t, /Worst-case cost: \$0\.07 \(estimated\)/);
  assert.match(t, /Remaining budget: \$18\.42/);
});

test('a malformed / partial offer is NOT approvable', () => {
  assert.equal(offerIsApprovable({ offerId: 'esc', token: 't', target: { providerId: 'a', modelId: 'm' }, request: {} }), true);
  assert.equal(offerIsApprovable({ offerId: 'esc', token: 't', target: { providerId: 'a', modelId: 'm' } }), false); // no request
  assert.equal(offerIsApprovable({ offerId: 'esc', token: 't', request: {} }), false); // no target
  assert.equal(offerIsApprovable(undefined), false);
  assert.equal(OFFER_EXPIRED_MESSAGE, 'This cloud offer expired. Request a new evaluation.');
});

test('attribution: local success, cloud fallback used, and fallback-recommended are distinct', () => {
  const local = attributionView({ provider: 'local', model: 'qwen', effectivePolicy: 'local-first' });
  assert.match(local.headline, /Handled locally · local · qwen/);

  const cloud = attributionView({ viaEscalation: true, provider: 'anthropic', model: 'claude-sonnet-5', escalationReason: 'LOCAL_CONTEXT_LIMIT', approvedCeilingUsd: 0.07, costUsd: 0.04, costStatus: 'estimated' });
  assert.match(cloud.headline, /Cloud fallback used · anthropic · claude-sonnet-5/);
  assert.match(cloud.lines.join('\n'), /context limit/);
  assert.match(cloud.lines.join('\n'), /Approved cost ceiling: \$0\.07/);
  assert.match(cloud.lines.join('\n'), /Actual estimated cost: \$0\.04/);

  const rec = attributionView({ provider: 'local', model: 'qwen', fallbackRecommended: true });
  assert.match(rec.headline, /Local result returned/);
  assert.match(rec.lines.join('\n'), /recommended but not approved/);
});

test('attribution shows requested→effective when the server downgraded the policy', () => {
  const a = attributionView({ provider: 'local', requestedPolicy: 'best-quality', effectivePolicy: 'local-only', policyReason: 'Cloud providers are disabled' });
  assert.match(a.lines.join('\n'), /Policy: best-quality → local-only \(Cloud providers are disabled\)/);
});

test('failure view maps codes to messages and KEEPS the machine code', () => {
  assert.deepEqual(failureView('BUDGET_EXCEEDED'), { message: 'Cloud execution was blocked because the approved budget is insufficient.', code: 'BUDGET_EXCEEDED' });
  assert.equal(failureView('CLOUD_DATA_TRANSFER_NOT_ALLOWED').message, 'The current privacy policy does not allow this data to leave the local environment.');
  assert.equal(failureView('SOMETHING_NEW').code, 'SOMETHING_NEW'); // unknown code still preserved
  assert.equal(failureView(undefined).code, 'UNKNOWN');
});

test('reason wording + short correlation are safe and bounded', () => {
  assert.equal(escalationReasonText('LOCAL_TIMEOUT'), 'The local model timed out');
  assert.equal(escalationReasonText('WEIRD'), 'WEIRD');
  assert.equal(shortCorrelation('corr_abcdef0123456789'), 'corr_a…6789');
  assert.equal(shortCorrelation(undefined), '—');
});
