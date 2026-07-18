// Intelligent Provider Router — Slice 3, commit 4: no-silent-cloud invariants.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { registerEscalationRoutes } from '../src/engine/providers/escalationRoutes.js';
import { EscalationController } from '../src/engine/providers/escalationController.js';
import { EscalationOfferStore } from '../src/engine/providers/escalationStore.js';
import { CloudEscalationExecutor } from '../src/engine/providers/cloudEscalationExecutor.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { evaluateEscalation } from '../src/engine/providers/escalation.js';
import { ModelRegistry } from '../src/engine/modelRegistry.js';
import type { Provider } from '../src/engine/providers/types.js';
import type { ExecutionPolicyId } from '../src/engine/providers/executionPolicy.js';

const CAPS = { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true };
function cloud(): Provider {
  return { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', credentialEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-5', capabilities: CAPS, priority: 60, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled: true };
}

test('INVARIANT: escalation is IMPOSSIBLE under every external-prohibiting policy', () => {
  const snap = { providers: [{ provider: { ...cloud(), hasCredential: true, health: { status: 'healthy' as const, reachable: true, lastCheckedAt: 1 } }, models: [], declaredCapabilities: CAPS, modelBackedCapabilities: CAPS, effectiveCapabilities: CAPS }], generatedAt: 1 };
  for (const policy of ['local-only', 'privacy-first'] as ExecutionPolicyId[]) {
    for (const reason of ['LOCAL_TIMEOUT', 'LOCAL_MALFORMED_OUTPUT', 'LOCAL_CONTEXT_LIMIT', 'LOCAL_UNSUPPORTED_CAPABILITY'] as const) {
      const d = evaluateEscalation({ policy, reason, fleet: snap, requiredCaps: { coding: true }, estInputTokens: 1000, estOutputTokens: 500, budgetCapUsd: 100 });
      assert.equal(d.offered, false, `${policy}/${reason} must never offer`);
    }
  }
});

test('INVARIANT: the approve endpoint refuses without an offer token — no cloud runs', async () => {
  const env = { ANTHROPIC_API_KEY: 'present' } as NodeJS.ProcessEnv;
  const registry = new ProviderRegistry([cloud()], (n) => env[n]);
  const fleet = new FleetRegistry(registry, new ModelRegistry({ sources: [], staticModels: [] }), { now: () => 1 });
  let cloudCalls = 0;
  const exec = new CloudEscalationExecutor(() => ({ name: 'c', async complete() { cloudCalls++; return { content: 'x', telemetry: { inputTokens: 1, outputTokens: 1 } } as never; }, async *stream() {}, async isAvailable() { return true; } } as never), env);
  const controller = new EscalationController(new EscalationOfferStore(), exec, fleet, registry, 1);
  const app = Fastify({ logger: false });
  registerEscalationRoutes(app, controller);

  // Missing fields → 400, no cloud.
  assert.equal((await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: {} })).statusCode, 400);
  // Fabricated offer id/token → 409, no cloud.
  const forged = await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: 'esc_forged', token: 'escok_forged', request: { feature: 'chat', modelProfile: 'default', systemPromptId: 'x', userPrompt: 'y', context: {}, outputMode: 'markdown' } } });
  assert.equal(forged.statusCode, 409);
  assert.equal(cloudCalls, 0, 'no cloud attempt without a valid offer');
  await app.close();
});

test('INVARIANT: no route or control-plane file runs a cloud attempt inline — only the executor does', () => {
  const root = process.cwd();
  // The coding surfaces + control plane must OFFER only; they must never call the
  // executor or the approval path inline.
  const surfaces = [
    path.join(root, 'src', 'engine', 'engineerRoutes.ts'),
    path.join(root, 'src', 'engine', 'aiRoutes.ts'),
  ];
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of surfaces) {
    const src = stripComments(readFileSync(file, 'utf8'));
    assert.ok(!/\.attempt\(/.test(src), `${path.basename(file)} must not run a cloud attempt inline`);
    assert.ok(!/CloudEscalationExecutor/.test(src), `${path.basename(file)} must not construct the cloud executor`);
    assert.ok(!/\.approve\(/.test(src), `${path.basename(file)} must not self-approve escalation`);
  }
  // Only cloudEscalationExecutor.ts issues the cloud completion in the providers dir.
  const dir = path.join(root, 'src', 'engine', 'providers');
  const executorSrc = stripComments(readFileSync(path.join(dir, 'cloudEscalationExecutor.ts'), 'utf8'));
  assert.ok(/\.complete\(/.test(executorSrc), 'the sanctioned executor is the one that completes');
});
