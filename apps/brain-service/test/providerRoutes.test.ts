// Intelligent Provider Router — Slice 1, commit 4: inspection API + invariants.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { registerProviderRoutes } from '../src/engine/providers/routes.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { PolicyEngine } from '../src/engine/providers/executionPolicy.js';
import { buildProviderRegistry } from '../src/engine/providers/config.js';
import { ModelRegistry } from '../src/engine/modelRegistry.js';

function appWith(env: NodeJS.ProcessEnv) {
  const providerRegistry = buildProviderRegistry(env);
  const fleet = new FleetRegistry(providerRegistry, new ModelRegistry({ sources: [], staticModels: [] }));
  const app = Fastify({ logger: false });
  registerProviderRoutes(app, { fleet, engine: new PolicyEngine(), defaultPolicy: env.MIGRAPILOT_EXECUTION_POLICY });
  return app;
}

test('GET /providers lists the fleet with health and never leaks a credential value', async () => {
  const app = appWith({ MIGRAPILOT_PROVIDER_OPENAI_ENABLED: 'true', OPENAI_API_KEY: 'sk-super-secret-123' });
  const res = await app.inject({ method: 'GET', url: '/api/ai/providers' });
  assert.ok(!res.body.includes('sk-super-secret-123'), 'no credential value in response');
  assert.ok(res.body.includes('OPENAI_API_KEY'), 'env NAME is safe to show');
  const j = res.json();
  const ids = j.providers.map((p: { id: string }) => p.id).sort();
  assert.deepEqual(ids, ['anthropic', 'local', 'openai']);
  const openai = j.providers.find((p: { id: string }) => p.id === 'openai');
  assert.equal(openai.hasCredential, true);
  assert.ok('health' in openai);
  await app.close();
});

test('cloud providers are disabled by default in the default fleet', async () => {
  const app = appWith({});
  const j = (await app.inject({ method: 'GET', url: '/api/ai/providers' })).json();
  const byId = new Map(j.providers.map((p: { id: string; enabled: boolean }) => [p.id, p.enabled]));
  assert.equal(byId.get('local'), true);
  assert.equal(byId.get('openai'), false);
  assert.equal(byId.get('anthropic'), false);
  await app.close();
});

test('GET /providers/policies returns all seven policies + custom and a default', async () => {
  const app = appWith({});
  const j = (await app.inject({ method: 'GET', url: '/api/ai/providers/policies' })).json();
  assert.equal(j.policies.length, 8);
  assert.equal(j.default, 'auto');
  await app.close();
});

test('POST /providers/plan returns a DRY-RUN plan; unknown policy → 400', async () => {
  const app = appWith({});
  const ok = await app.inject({ method: 'POST', url: '/api/ai/providers/plan', payload: { policy: 'local-only' } });
  assert.equal(ok.statusCode, 200);
  const plan = ok.json().plan;
  assert.equal(plan.dryRun, true);
  assert.equal(plan.policy, 'local-only');
  assert.equal(plan.chosen.providerId, 'local'); // cloud disabled + excluded
  const bad = await app.inject({ method: 'POST', url: '/api/ai/providers/plan', payload: { policy: 'restart' } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, 'UNKNOWN_POLICY');
  await app.close();
});

test('INVARIANT: the provider control plane issues NO completion and touches NO routing', () => {
  const dir = path.join(process.cwd(), 'src', 'engine', 'providers');
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const forbidden = [
    /chat\/completions/, // must not call a completion endpoint
    /\.complete\(/,
    /\bstreamChat\b/,
    /\.stream\(/,
    /\bselectModel\b/, // must not invoke the live capability router
    /\bdecideRoute\b/,
    /child_process/,
  ];
  // The registry / fleet / policy / local-first-selection control plane never
  // completes. cloudEscalationExecutor.ts is the SINGLE sanctioned cloud executor
  // (approval-gated, one-shot) and is intentionally exempt — it has its own tests
  // and Slice-3 no-silent-cloud invariants.
  const SANCTIONED_EXECUTOR = 'cloudEscalationExecutor.ts';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== SANCTIONED_EXECUTOR)) {
    const src = stripComments(readFileSync(path.join(dir, file), 'utf8'));
    for (const re of forbidden) assert.ok(!re.test(src), `${file} must not contain ${re}`);
  }
});
