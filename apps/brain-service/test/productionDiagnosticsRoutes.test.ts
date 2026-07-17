// Operational Readiness Slice 5 — operator API routes (commit 3).
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerProductionDiagnosticsRoutes } from '../src/engine/production/routes.js';
import { ProductionDiagnosticsProvider, type ProviderConfig } from '../src/engine/production/provider.js';
import { ProductionTargetRegistry, type ProductionTarget } from '../src/engine/production/targetRegistry.js';
import { defaultCapabilities } from '../src/engine/production/capabilities.js';
import { NullProber, type ServiceStatus } from '../src/engine/production/deps.js';
import { ToolApprovalStore } from '../src/engine/toolApprovalStore.js';

const OP = 'ops:alice';
const TOKEN = 'diag-token-abc';

function target(): ProductionTarget {
  return {
    targetId: 'svc-1', tenantId: 'ten', environment: 'production', serviceType: 'container', displayName: 'Svc',
    approvedEndpoints: [{ id: 'primary', host: 'svc.internal' }], approvedCapabilities: ['production.diagnostics.serviceHealth'],
    credentialRef: 'diag-ro-cred', timeoutMs: 5000, rateLimitPerMinute: 1000, redactionProfile: 'standard', enabled: true,
  };
}

class HealthyProber extends NullProber {
  override async serviceStatus(): Promise<ServiceStatus> {
    return { exists: true, state: 'running', dependencyReachable: true };
  }
}

function appWith(enabled = true) {
  const cfg: ProviderConfig = { enabled, approvedEnvironments: ['production'], operators: new Set([OP]), maxTimeoutMs: 5000 };
  const provider = new ProductionDiagnosticsProvider(cfg, new ProductionTargetRegistry([target()]), defaultCapabilities(), new HealthyProber());
  const app = Fastify({ logger: false });
  registerProductionDiagnosticsRoutes(app, provider, new Map([[TOKEN, OP]]));
  return app;
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

test('GET /status labels the mode read-only and reports enablement', async () => {
  const app = appWith(true);
  const r = (await app.inject({ method: 'GET', url: '/api/ai/production-diagnostics/status' })).json();
  assert.equal(r.mode, 'Production Diagnostics — Read Only');
  assert.equal(r.enabled, true);
  assert.ok(r.capabilities.includes('production.diagnostics.serviceHealth'));
  await app.close();
});

test('GET /targets returns safe summaries with NO credential reference or raw host', async () => {
  const app = appWith(true);
  const res = await app.inject({ method: 'GET', url: '/api/ai/production-diagnostics/targets' });
  assert.ok(!res.body.includes('diag-ro-cred'), 'no credentialRef in response');
  assert.ok(!res.body.includes('svc.internal'), 'no raw endpoint host in response');
  const j = res.json();
  assert.equal(j.targets[0].targetId, 'svc-1');
  assert.deepEqual(j.targets[0].endpointIds, ['primary']);
  await app.close();
});

test('POST /run with a valid operator token succeeds and returns a redacted result + correlation', async () => {
  const app = appWith(true);
  const res = await app.inject({ method: 'POST', url: '/api/ai/production-diagnostics/run', headers: { ...bearer(TOKEN), 'x-correlation-id': 'corr-xyz' }, payload: { targetId: 'svc-1', capability: 'production.diagnostics.serviceHealth' } });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.ok, true);
  assert.equal(j.result.status, 'healthy');
  assert.equal(j.correlationId, 'corr-xyz');
  assert.ok(j.runId.startsWith('pdr_'));
  // fetch it back
  const back = (await app.inject({ method: 'GET', url: `/api/ai/production-diagnostics/runs/${j.runId}` })).json();
  assert.equal(back.run.status, 'healthy');
  await app.close();
});

test('POST /run without a token → 401 UNAUTHORIZED', async () => {
  const app = appWith(true);
  const res = await app.inject({ method: 'POST', url: '/api/ai/production-diagnostics/run', payload: { targetId: 'svc-1', capability: 'production.diagnostics.serviceHealth' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'UNAUTHORIZED');
  await app.close();
});

test('a WORKSPACE approval-store token cannot authorize a production diagnostic', async () => {
  const app = appWith(true);
  const approvals = new ToolApprovalStore();
  const minted = approvals.mint({ tool: 'edit.apply', inputHash: 'h', requestId: 'r' });
  const res = await app.inject({ method: 'POST', url: '/api/ai/production-diagnostics/run', headers: bearer(minted.id), payload: { targetId: 'svc-1', capability: 'production.diagnostics.serviceHealth' } });
  assert.equal(res.statusCode, 401, 'workspace approval token is a different token space');
  assert.equal(res.json().code, 'UNAUTHORIZED');
  await app.close();
});

test('POST /run to an unregistered target → 403 TARGET_NOT_ALLOWED (no run recorded via arbitrary target)', async () => {
  const app = appWith(true);
  const res = await app.inject({ method: 'POST', url: '/api/ai/production-diagnostics/run', headers: bearer(TOKEN), payload: { targetId: 'evil-host', capability: 'production.diagnostics.serviceHealth' } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'TARGET_NOT_ALLOWED');
  await app.close();
});

test('POST /run asking for a mutation → 403 READ_ONLY_CAPABILITY', async () => {
  const app = appWith(true);
  for (const cap of ['service.restart', 'production.diagnostics.restart', 'deploy']) {
    const res = await app.inject({ method: 'POST', url: '/api/ai/production-diagnostics/run', headers: bearer(TOKEN), payload: { targetId: 'svc-1', capability: cap } });
    assert.equal(res.statusCode, 403, cap);
    assert.equal(res.json().code, 'READ_ONLY_CAPABILITY', cap);
  }
  await app.close();
});

test('disabled provider: /run fails closed 403 PROVIDER_DISABLED', async () => {
  const app = appWith(false);
  const res = await app.inject({ method: 'POST', url: '/api/ai/production-diagnostics/run', headers: bearer(TOKEN), payload: { targetId: 'svc-1', capability: 'production.diagnostics.serviceHealth' } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'PROVIDER_DISABLED');
  await app.close();
});

test('GET /runs/:id for an unknown id → 404', async () => {
  const app = appWith(true);
  const res = await app.inject({ method: 'GET', url: '/api/ai/production-diagnostics/runs/pdr_nope' });
  assert.equal(res.statusCode, 404);
  await app.close();
});
