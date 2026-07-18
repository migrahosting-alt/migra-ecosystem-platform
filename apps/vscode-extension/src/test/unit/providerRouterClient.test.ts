// Intelligent Provider Router — Slice 5, commit 1: typed client + policy/provider VM.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { ProviderRouterClient, ProviderRouterError } from '../../services/providerRouterClient.js';
import { policyPickItems, policyStatusLabel, policyEffectiveNote, providerRows, budgetRows, usd } from '../../panel/providerRouterViewModel.js';

let server: Server;
let baseUrl = '';
let lastApprove: Record<string, unknown> | undefined;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

before(async () => {
  server = createServer(async (req, res) => {
    const url = req.url ?? '';
    if (url === '/api/ai/providers') return json(res, 200, { mode: 'x', defaultPolicy: 'auto', providers: [{ id: 'local', displayName: 'Local (on-device)', kind: 'local', enabled: true, hasCredential: true, dataLocality: 'on-device', health: { status: 'healthy' }, effectiveCapabilities: { chat: true, coding: true }, models: [{ id: 'qwen', tier: 'balanced' }], credentialEnv: 'SECRET_NAME' }] });
    if (url === '/api/ai/providers/policies') return json(res, 200, { policies: [{ id: 'auto', displayName: 'Auto', description: 'a' }, { id: 'cloud-first', displayName: 'Cloud Preferred Fallback', description: 'b' }], default: 'auto' });
    if (url === '/api/ai/providers/budget') return json(res, 200, { enabled: false, currency: 'USD', scopes: [] });
    if (url.startsWith('/api/ai/providers/usage')) return json(res, 200, { records: [], summary: { cloud: { count: 0, costUsd: 0 }, local: { count: 3, estimatedSavingsUsd: 0.09, savingsStatus: 'estimated' }, byProvider: {} } });
    if (url === '/api/ai/escalation/approve') { lastApprove = await readBody(req); if (lastApprove.token === 'bad') return json(res, 409, { ok: false, code: 'OFFER_INVALID' }); return json(res, 200, { ok: true, escalation: { provider: 'anthropic', model: 'claude-sonnet-5', reason: 'LOCAL_TIMEOUT', viaEscalation: true }, content: 'x' }); }
    json(res, 404, { code: 'NOT_FOUND' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
after(() => server.close());

function client() {
  return new ProviderRouterClient({ baseUrl: () => baseUrl, timeoutMs: () => 3000, log: () => {} });
}

test('client reads providers, policies, budget, usage (typed)', async () => {
  const c = client();
  const providers = await c.getProviders();
  assert.equal(providers.providers[0]!.id, 'local');
  const policies = await c.getPolicies();
  assert.equal(policies.policies[1]!.displayName, 'Cloud Preferred Fallback');
  assert.equal((await c.getBudget()).enabled, false);
  assert.equal((await c.getUsage({ localOrCloud: 'local' })).summary.local.count, 3);
});

test('escalation approval submits ONLY the offer reference; a bad offer surfaces the code', async () => {
  const c = client();
  const ok = await c.approveEscalation('esc_1', 'tok', { userPrompt: 'p' });
  assert.equal(ok.ok, true);
  assert.equal(ok.escalation?.provider, 'anthropic');
  assert.deepEqual(Object.keys(lastApprove!).sort(), ['offerId', 'request', 'token']); // no provider/model/reason/ceiling from client
  const bad = await c.approveEscalation('esc_1', 'bad', { userPrompt: 'p' });
  assert.equal(bad.ok, false);
});

test('client raises a typed ProviderRouterError on HTTP failure', async () => {
  // /api/ai/providers/plan is unhandled by the mock → 404 → typed error.
  await assert.rejects(() => client().getPlan('auto'), (e: unknown) => e instanceof ProviderRouterError && e.status === 404);
});

test('policy view-model: pick items mark current, status label, requested-vs-effective note', () => {
  const policies = [{ id: 'auto' as const, displayName: 'Auto', description: 'a' }, { id: 'cloud-first' as const, displayName: 'Cloud Preferred Fallback', description: 'b' }];
  const items = policyPickItems(policies, 'cloud-first');
  assert.equal(items[1]!.picked, true);
  assert.ok(items[1]!.label.startsWith('●'));
  assert.ok(items[0]!.label.startsWith('○'));
  assert.equal(policyStatusLabel(policies, 'cloud-first'), 'MigraPilot: Cloud Preferred Fallback');
  assert.equal(policyEffectiveNote('cloud-first', 'cloud-first'), undefined);
  assert.match(String(policyEffectiveNote('best-quality', 'local-only', 'Cloud providers are disabled')), /Requested policy: best-quality.*Effective policy: local-only.*Reason/);
});

test('provider rows never leak a credential env name/value; cloud disabled shows disabled', () => {
  const rows = providerRows([
    { id: 'local', displayName: 'Local (on-device)', kind: 'local', enabled: true, hasCredential: true, dataLocality: 'on-device', health: { status: 'healthy' }, effectiveCapabilities: { chat: true, coding: true }, models: [{ id: 'qwen', tier: 'balanced' }] },
    { id: 'anthropic', displayName: 'Claude', kind: 'cloud', enabled: false, hasCredential: false, dataLocality: 'external', health: { status: 'disabled' }, effectiveCapabilities: { chat: true }, models: [] },
  ]);
  assert.equal(rows[0]!.tone, 'ok');
  assert.equal(rows[1]!.note, 'Disabled');
  assert.ok(!JSON.stringify(rows).includes('SECRET_NAME'));
});

test('usd() never renders an unknown cost as $0.00', () => {
  assert.equal(usd(undefined, 'unknown'), 'cost unknown');
  assert.equal(usd(0.08, 'estimated'), '$0.08 (estimated)');
  assert.equal(usd(1.5, 'actual'), '$1.50');
});

test('budget rows: disabled budget is shown as disabled, local savings honest', () => {
  const rows = budgetRows({ enabled: false, currency: 'USD', scopes: [] }, { records: [], summary: { cloud: { count: 0, costUsd: 0 }, local: { count: 5, estimatedSavingsUsd: 0, savingsStatus: 'unknown' }, byProvider: {} } });
  assert.ok(rows.some((r) => r.label === 'Cloud spending' && r.value === 'disabled'));
  assert.ok(rows.some((r) => r.label === 'Estimated avoided cloud spend' && r.value === 'unknown'));
});
