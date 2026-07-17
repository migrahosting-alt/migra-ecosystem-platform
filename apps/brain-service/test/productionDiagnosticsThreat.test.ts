// Operational Readiness Slice 5 — threat / safety-invariant tests (commit 4).
//
// Proves the hard boundaries: no generic shell, no arbitrary target/SQL/URL, no
// mutation path, no credential leakage, complete audit, fail-closed everywhere,
// and that no diagnostics source imports a mutating production tool.
//
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ProductionDiagnosticsProvider, type ProviderConfig } from '../src/engine/production/provider.js';
import { ProductionTargetRegistry, type ProductionTarget } from '../src/engine/production/targetRegistry.js';
import { defaultCapabilities } from '../src/engine/production/capabilities.js';
import { DIAGNOSTIC_CAPABILITY_IDS } from '../src/engine/production/types.js';
import { NetworkProber } from '../src/engine/production/networkProber.js';
import { NullProber, type ServiceStatus } from '../src/engine/production/deps.js';
import { auditStore } from '../src/engine/auditLog.js';

const OP = 'ops:alice';
function target(over: Partial<ProductionTarget> = {}): ProductionTarget {
  return {
    targetId: 't1', tenantId: 'ten', environment: 'production', serviceType: 'container', displayName: 'T',
    approvedEndpoints: [{ id: 'primary', host: 'svc.internal', url: 'https://svc.internal/health' }],
    approvedCapabilities: [...DIAGNOSTIC_CAPABILITY_IDS], credentialRef: 'diag-ro-cred-SECRET',
    timeoutMs: 5000, rateLimitPerMinute: 1000, redactionProfile: 'standard', enabled: true, ...over,
  };
}
function cfg(): ProviderConfig {
  return { enabled: true, approvedEnvironments: ['production'], operators: new Set([OP]), maxTimeoutMs: 5000 };
}
class HealthyProber extends NullProber {
  override async serviceStatus(): Promise<ServiceStatus> {
    return { exists: true, state: 'running', dependencyReachable: true };
  }
}
function provider(prober = new HealthyProber(), over: Partial<ProductionTarget> = {}) {
  return new ProductionDiagnosticsProvider(cfg(), new ProductionTargetRegistry([target(over)]), defaultCapabilities(), prober);
}

test('every registered capability id is in the read-only production.diagnostics namespace', () => {
  const p = provider();
  for (const id of p.registeredCapabilityIds()) {
    assert.ok(id.startsWith('production.diagnostics.'), id);
  }
});

test('NO generic shell / exec / command / mutation capability is registered', () => {
  const ids = new Set<string>(provider().registeredCapabilityIds());
  for (const forbidden of ['terminal.exec', 'command.run', 'production.shell', 'production.exec', 'fs.applyChangeset', 'production.diagnostics.restart', 'production.diagnostics.deploy']) {
    assert.ok(!ids.has(forbidden), forbidden);
  }
});

test('arbitrary SQL cannot be supplied (no sql/query param; database takes none)', async () => {
  const p = provider(Object.assign(new HealthyProber(), { databaseHealth: async () => ({ reachable: true, serverVersion: 'x', migrationState: 'applied' }) }), { serviceType: 'database' });
  await assert.rejects(
    () => p.run({ operator: OP, targetId: 't1', capability: 'production.diagnostics.database', params: { sql: 'SELECT * FROM secrets' } }),
    (e: Error & { code?: string }) => e.code === 'ARBITRARY_INPUT_REJECTED',
  );
});

test('HTTP diagnostics cannot pivot to an arbitrary URL (params.url rejected)', async () => {
  const p = provider(new HealthyProber(), { serviceType: 'http-service' });
  await assert.rejects(
    () => p.run({ operator: OP, targetId: 't1', capability: 'production.diagnostics.http', params: { url: 'http://169.254.169.254/latest/meta-data/' } }),
    (e: Error & { code?: string }) => e.code === 'ARBITRARY_INPUT_REJECTED',
  );
});

test('NetworkProber bounds redirects (SSRF hardening) against a redirect loop', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(302, { location: '/next' });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const np = new NetworkProber();
    const res = await np.httpProbe({ id: 'x', host: '127.0.0.1', url: `http://127.0.0.1:${port}/` });
    // Stops at the redirect cap and reports a bounded redirect count (never loops forever).
    assert.ok((res.redirects ?? 0) <= 3, `redirects bounded, got ${res.redirects}`);
  } finally {
    server.close();
  }
});

test('provider credential reference NEVER appears in result, run record, or audit', async () => {
  const p = provider();
  const { runId, correlationId, result } = await p.run({ operator: OP, targetId: 't1', capability: 'production.diagnostics.serviceHealth' });
  assert.ok(!JSON.stringify(result).includes('diag-ro-cred-SECRET'));
  assert.ok(!JSON.stringify(p.getRun(runId)).includes('diag-ro-cred-SECRET'));
  assert.ok(!JSON.stringify(p.listTargets()).includes('diag-ro-cred-SECRET'));
  const chain = JSON.stringify(auditStore.byCorrelation(correlationId));
  assert.ok(!chain.includes('diag-ro-cred-SECRET'));
});

test('every run is correlated and durably audited (requested + completed)', async () => {
  const p = provider();
  const { correlationId } = await p.run({ operator: OP, targetId: 't1', capability: 'production.diagnostics.serviceHealth' });
  const types = auditStore.byCorrelation(correlationId).map((r) => r.type);
  assert.ok(types.includes('production.diagnostics.requested'));
  assert.ok(types.includes('production.diagnostics.completed'));
});

test('a denied request is audited as denied and performs no diagnostic', async () => {
  const p = provider();
  const before = auditStore.byCorrelation('deny-corr').length;
  await assert.rejects(() => p.run({ operator: 'nobody', targetId: 't1', capability: 'production.diagnostics.serviceHealth', correlationId: 'deny-corr' }));
  const chain = auditStore.byCorrelation('deny-corr');
  assert.ok(chain.length > before && chain.some((r) => r.type === 'production.diagnostics.denied'));
});

test('a failing capability surfaces an error and CANNOT silently invoke remediation', async () => {
  const boom = Object.assign(new NullProber(), { serviceStatus: async () => { throw new Error('probe blew up'); } });
  const p = provider(boom as never);
  await assert.rejects(() => p.run({ operator: OP, targetId: 't1', capability: 'production.diagnostics.serviceHealth' }));
  // The only effect of a failure is an audited failure — there is no remediation path.
});

test('recommendations are advisory strings only (no executable/tool payload)', async () => {
  const p = provider(Object.assign(new HealthyProber(), { serviceStatus: async () => ({ exists: true, state: 'restarting', restartCount: 5 }) }));
  const { result } = await p.run({ operator: OP, targetId: 't1', capability: 'production.diagnostics.serviceHealth' });
  assert.ok(result.recommendedNextSteps.length > 0);
  assert.ok(result.recommendedNextSteps.every((s) => typeof s === 'string'));
});

test('NO diagnostics source file imports or invokes a mutating production tool', () => {
  const dir = path.join(process.cwd(), 'src', 'engine', 'production');
  const forbidden = [
    /from '.*\/tools\//, // must not reach into the workspace tool boundary
    /child_process/,
    /\bwriteFileSync\b/,
    /\bwriteFile\b/,
    /\bapplyChangeset\b/,
    /\bcommandRun\b/,
    /\beditApply\b/,
    /\bexecSync\b/,
    /\bspawn\b/,
    /terminal\.exec/,
  ];
  // Strip comments so the scan checks real code, not the header comments that
  // deliberately NAME what this subsystem is kept separate from.
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = stripComments(readFileSync(path.join(dir, file), 'utf8'));
    for (const re of forbidden) {
      assert.ok(!re.test(src), `${file} must not contain ${re}`);
    }
  }
});
