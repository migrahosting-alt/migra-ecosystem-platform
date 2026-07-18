// Operational Readiness Slice 5 — provider framework + policy boundary (commit 1).
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProductionDiagnosticsProvider, type ProviderConfig } from '../src/engine/production/provider.js';
import { ProductionTargetRegistry, type ProductionTarget } from '../src/engine/production/targetRegistry.js';
import { coreCapabilities } from '../src/engine/production/capabilities.js';
import { DiagnosticError } from '../src/engine/production/types.js';
import { NullProber, type Prober, type ServiceStatus } from '../src/engine/production/deps.js';
import { readProviderConfig, loadTargetRegistry } from '../src/engine/production/config.js';

const OP = 'ops:alice';

function target(over: Partial<ProductionTarget> = {}): ProductionTarget {
  return {
    targetId: 'svc-web-1',
    tenantId: 'tenant-a',
    environment: 'production',
    serviceType: 'container',
    displayName: 'Web service',
    approvedEndpoints: [{ id: 'primary', host: 'web.internal' }],
    approvedCapabilities: ['production.diagnostics.serviceHealth'],
    timeoutMs: 5000,
    rateLimitPerMinute: 60,
    redactionProfile: 'standard',
    enabled: true,
    ...over,
  };
}

function cfg(over: Partial<ProviderConfig> = {}): ProviderConfig {
  return { enabled: true, approvedEnvironments: ['production'], operators: new Set([OP]), maxTimeoutMs: 5000, ...over };
}

/** A deterministic read-only prober returning a healthy running service. */
class HealthyProber extends NullProber {
  override async serviceStatus(): Promise<ServiceStatus> {
    return { exists: true, state: 'running', uptimeSec: 3600, restartCount: 0, versionId: 'v1.2.3', dependencyReachable: true };
  }
}

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof DiagnosticError ? e.code : `OTHER:${(e as Error).message}`;
  }
}

test('provider is DISABLED by default from an empty environment (fails closed)', async () => {
  const provider = new ProductionDiagnosticsProvider(readProviderConfig({}), loadTargetRegistry({}), coreCapabilities(), new NullProber());
  assert.equal(provider.isEnabled(), false);
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'x', capability: 'production.diagnostics.serviceHealth' })), 'PROVIDER_DISABLED');
});

test('disabled provider returns a truthful fail-closed error even for a valid request', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg({ enabled: false }), new ProductionTargetRegistry([target()]), coreCapabilities());
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' })), 'PROVIDER_DISABLED');
});

test('unauthorized operator is rejected', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target()]), coreCapabilities(), new HealthyProber());
  assert.equal(await code(() => provider.run({ operator: 'ops:mallory', targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' })), 'UNAUTHORIZED');
});

test('unknown / unregistered target fails closed as TARGET_NOT_ALLOWED', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target()]), coreCapabilities(), new HealthyProber());
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'does-not-exist', capability: 'production.diagnostics.serviceHealth' })), 'TARGET_NOT_ALLOWED');
});

test('a disabled target is indistinguishable from unknown (TARGET_NOT_ALLOWED)', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target({ enabled: false })]), coreCapabilities(), new HealthyProber());
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' })), 'TARGET_NOT_ALLOWED');
});

test('environment outside the allowlist fails closed', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg({ approvedEnvironments: ['staging'] }), new ProductionTargetRegistry([target()]), coreCapabilities(), new HealthyProber());
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' })), 'ENVIRONMENT_NOT_ALLOWED');
});

test('a capability not approved for the target fails closed', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target({ approvedCapabilities: [] })]), coreCapabilities(), new HealthyProber());
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' })), 'CAPABILITY_NOT_ALLOWED_FOR_TARGET');
});

test('a mutation / unknown capability is refused with READ_ONLY_CAPABILITY', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target()]), coreCapabilities(), new HealthyProber());
  for (const cap of ['production.diagnostics.restart', 'service.restart', 'production.deploy', 'terminal.exec']) {
    assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: cap })), 'READ_ONLY_CAPABILITY', cap);
  }
});

test('client-supplied arbitrary target keys (host/url/port/command/sql/path) are rejected', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target()]), coreCapabilities(), new HealthyProber());
  for (const bad of [{ host: 'evil.example' }, { url: 'http://169.254.169.254/' }, { port: 22 }, { command: 'rm -rf /' }, { sql: 'DROP TABLE users' }, { path: '/etc/passwd' }, { ssh: 'root@host' }]) {
    assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth', params: bad })), 'ARBITRARY_INPUT_REJECTED', JSON.stringify(bad));
  }
});

test('an endpointId that is not an approved endpoint is rejected', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target()]), coreCapabilities(), new HealthyProber());
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth', params: { endpointId: 'not-approved' } })), 'ARBITRARY_INPUT_REJECTED');
});

test('read-only service health returns bounded evidence + a run record + healthy status', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target()]), coreCapabilities(), new HealthyProber());
  const { runId, correlationId, result } = await provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' });
  assert.equal(result.status, 'healthy');
  assert.ok(result.evidence.exists === true && result.evidence.state === 'running');
  assert.ok(Array.isArray(result.recommendedNextSteps));
  assert.ok(runId.startsWith('pdr_') && correlationId.length > 0);
  assert.equal(provider.getRun(runId)?.status, 'healthy');
});

test('rate limit is enforced per target', async () => {
  const provider = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target({ rateLimitPerMinute: 1 })]), coreCapabilities(), new HealthyProber());
  await provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' });
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' })), 'RATE_LIMITED');
});

test('a slow capability is cut off by the timeout', async () => {
  const slow: Prober = Object.assign(new NullProber(), {
    serviceStatus: () => new Promise<ServiceStatus>((r) => setTimeout(() => r({ exists: true, state: 'running' }), 200)),
  });
  const provider = new ProductionDiagnosticsProvider(cfg({ maxTimeoutMs: 20 }), new ProductionTargetRegistry([target({ timeoutMs: 20 })]), coreCapabilities(), slow);
  assert.equal(await code(() => provider.run({ operator: OP, targetId: 'svc-web-1', capability: 'production.diagnostics.serviceHealth' })), 'TIMEOUT');
});
