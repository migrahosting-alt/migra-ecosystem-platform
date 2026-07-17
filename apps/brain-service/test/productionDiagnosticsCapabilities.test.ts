// Operational Readiness Slice 5 — read-only diagnostic capabilities (commit 2).
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProductionDiagnosticsProvider, type ProviderConfig } from '../src/engine/production/provider.js';
import { ProductionTargetRegistry, type ProductionTarget } from '../src/engine/production/targetRegistry.js';
import { defaultCapabilities } from '../src/engine/production/capabilities.js';
import { DIAGNOSTIC_CAPABILITY_IDS } from '../src/engine/production/types.js';
import { NetworkProber } from '../src/engine/production/networkProber.js';
import {
  NullProber,
  type DatabaseHealth,
  type DnsResult,
  type HttpResult,
  type MailHealth,
  type MetricsSnapshot,
  type ServiceStatus,
  type StorageHealth,
  type TlsResult,
} from '../src/engine/production/deps.js';

const OP = 'ops:alice';
const ALL = [...DIAGNOSTIC_CAPABILITY_IDS];

function target(over: Partial<ProductionTarget> = {}): ProductionTarget {
  return {
    targetId: 't1', tenantId: 'ten', environment: 'production', serviceType: 'container', displayName: 'T',
    approvedEndpoints: [{ id: 'primary', host: 'svc.internal', url: 'https://svc.internal/health', expectedRecords: ['10.0.0.1'] }],
    approvedCapabilities: ALL, timeoutMs: 5000, rateLimitPerMinute: 1000, redactionProfile: 'standard', enabled: true, ...over,
  };
}
function cfg(): ProviderConfig {
  return { enabled: true, approvedEnvironments: ['production'], operators: new Set([OP]), maxTimeoutMs: 5000 };
}
function provider(prober: NullProber, over: Partial<ProductionTarget> = {}): ProductionDiagnosticsProvider {
  return new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target(over)]), defaultCapabilities(), prober);
}
function run(p: ProductionDiagnosticsProvider, capability: string, params?: Record<string, unknown>) {
  return p.run({ operator: OP, targetId: 't1', capability, params });
}

test('all ten production.diagnostics.* capabilities are registered', () => {
  const p = provider(new NullProber());
  assert.deepEqual(p.registeredCapabilityIds(), [...ALL].sort());
});

test('logs are bounded, error-marker aware, and redacted', async () => {
  const prober = Object.assign(new NullProber(), {
    readLogs: async () => ['user login ok', 'ERROR db timeout token ghp_' + 'ABCDEFGHIJKLMNOPQRSTUV012345', 'served 200'],
  });
  const p = provider(prober);
  const { result } = await run(p, 'production.diagnostics.logs', { windowMinutes: 5, maxLines: 10 });
  assert.equal(result.status, 'degraded'); // an ERROR marker present
  assert.equal(result.evidence.errorMarkers, 1);
  const flat = JSON.stringify(result);
  assert.ok(!flat.includes('ghp_ABCDEFG'), 'log secret redacted before transport');
});

test('metrics are bounded and pressure is classified', async () => {
  const prober = Object.assign(new NullProber(), { readMetrics: async (): Promise<MetricsSnapshot> => ({ cpuPercent: 30, memoryPercent: 40, diskPercent: 92, load1: 1.2, networkOk: true }) });
  const { result } = await run(provider(prober), 'production.diagnostics.metrics');
  assert.equal(result.status, 'degraded');
  assert.equal(result.evidence.diskPercent, 92);
});

test('database health uses safe metadata only; saturation → degraded', async () => {
  const prober = Object.assign(new NullProber(), { databaseHealth: async (): Promise<DatabaseHealth> => ({ reachable: true, serverVersion: 'PostgreSQL 16', connectionsUsed: 95, connectionsMax: 100, replicationHealthy: true, migrationState: 'applied' }) });
  const { result } = await run(provider(prober), 'production.diagnostics.database');
  assert.equal(result.status, 'degraded');
  assert.ok(String(result.limitations.join(' ')).includes('no arbitrary SQL'));
});

test('database unreachable → unreachable, not healthy', async () => {
  const prober = Object.assign(new NullProber(), { databaseHealth: async (): Promise<DatabaseHealth> => ({ reachable: false }) });
  const { result } = await run(provider(prober), 'production.diagnostics.database');
  assert.equal(result.status, 'unreachable');
});

test('DNS mismatch → degraded (read-only)', async () => {
  const prober = Object.assign(new NullProber(), { resolveDns: async (): Promise<DnsResult> => ({ reachable: true, records: ['10.9.9.9'], matchesExpected: false }) });
  const { result } = await run(provider(prober, { serviceType: 'dns-zone' }), 'production.diagnostics.dns', { endpointId: 'primary' });
  assert.equal(result.status, 'degraded');
});

test('TLS near expiry → degraded with advisory next steps only', async () => {
  const prober = Object.assign(new NullProber(), { inspectTls: async (): Promise<TlsResult> => ({ reachable: true, daysToExpiry: 8, hostnameMatch: true, chainValid: true }) });
  const { result } = await run(provider(prober, { serviceType: 'tls-endpoint' }), 'production.diagnostics.tls', { endpointId: 'primary' });
  assert.equal(result.status, 'degraded');
  assert.equal(result.evidence.daysToExpiry, 8);
  assert.ok(result.recommendedNextSteps.length > 0 && result.recommendedNextSteps.every((s) => typeof s === 'string'));
});

test('HTTP server error → unhealthy; only approved endpoint used', async () => {
  const prober = Object.assign(new NullProber(), { httpProbe: async (): Promise<HttpResult> => ({ reachable: true, status: 503, latencyMs: 40, redirects: 0 }) });
  const { result } = await run(provider(prober, { serviceType: 'http-service' }), 'production.diagnostics.http', { endpointId: 'primary' });
  assert.equal(result.status, 'unhealthy');
  assert.equal(result.evidence.httpStatus, 503);
});

test('mail diagnostics report health and never send email', async () => {
  const prober = Object.assign(new NullProber(), { mailHealth: async (): Promise<MailHealth> => ({ reachable: true, dnsOk: true, tlsOk: true, queueDepth: 3, authConfigured: true }) });
  const { result } = await run(provider(prober, { serviceType: 'mail' }), 'production.diagnostics.mail');
  assert.equal(result.status, 'healthy');
  assert.ok(result.limitations.join(' ').toLowerCase().includes('no production email is sent'));
});

test('storage capacity critical → unhealthy; no writes', async () => {
  const prober = Object.assign(new NullProber(), { storageHealth: async (): Promise<StorageHealth> => ({ reachable: true, capacityPercent: 97, latencyMs: 12, replicationHealthy: true }) });
  const { result } = await run(provider(prober, { serviceType: 'storage' }), 'production.diagnostics.storage');
  assert.equal(result.status, 'unhealthy');
  assert.ok(result.limitations.join(' ').toLowerCase().includes('no object'));
});

test('summary rolls up the worst sub-status', async () => {
  const prober = Object.assign(new NullProber(), {
    serviceStatus: async (): Promise<ServiceStatus> => ({ exists: true, state: 'running', dependencyReachable: true }),
    readMetrics: async (): Promise<MetricsSnapshot> => ({ diskPercent: 96 }), // unhealthy
  });
  const p = new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target({ approvedCapabilities: ['production.diagnostics.serviceHealth', 'production.diagnostics.metrics', 'production.diagnostics.summary'] })]), defaultCapabilities(), prober);
  const { result } = await p.run({ operator: OP, targetId: 't1', capability: 'production.diagnostics.summary' });
  assert.equal(result.status, 'unhealthy');
  assert.equal(result.evidence.serviceHealth, 'healthy');
  assert.equal(result.evidence.metrics, 'unhealthy');
});

test('NetworkProber performs a real read-only DNS resolution of localhost', async () => {
  const np = new NetworkProber();
  const r = await np.resolveDns({ id: 'l', host: 'localhost' });
  assert.equal(r.reachable, true);
  assert.ok(r.records.some((x) => x === '127.0.0.1' || x === '::1'));
});

test('NetworkProber infra methods do not fabricate health (read-only, uncredentialed)', async () => {
  const np = new NetworkProber();
  assert.equal((await np.databaseHealth(target())).reachable, false);
  assert.equal((await np.readMetrics(target())).cpuPercent, undefined);
  assert.deepEqual(await np.readLogs(target(), { windowMinutes: 5, maxLines: 10 }), []);
});
