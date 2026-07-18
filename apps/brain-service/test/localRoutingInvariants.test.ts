// Intelligent Provider Router — Slice 2, commit 4: no-cloud invariants.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { selectLocalCoding } from '../src/engine/providers/localCodingRouter.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { PolicyEngine, EXECUTION_POLICIES, type ExecutionPolicyId } from '../src/engine/providers/executionPolicy.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import type { Provider } from '../src/engine/providers/types.js';

const CAPS = { chat: true, vision: true, tools: true, embedding: true, reasoning: true, coding: true };
function local(): Provider {
  return { id: 'local', displayName: 'Local', kind: 'local', protocol: 'openai-compat', baseUrl: 'http://x/v1', capabilities: CAPS, priority: 100, cost: { inputPer1M: 0, outputPer1M: 0 }, dataLocality: 'on-device', enabled: true };
}
function cloud(): Provider {
  return { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://a', credentialEnv: 'ANTHROPIC_API_KEY', capabilities: { ...CAPS, embedding: false }, priority: 90, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled: true };
}
function m(id: string, provider: string): ModelDescriptor {
  return { id, provider, capabilities: { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true, insert: false }, tier: 'deep' };
}

test('INVARIANT: under EVERY policy the execution target is a LOCAL model or null — never cloud', async () => {
  // A fleet where a cloud provider even has a (hypothetical) discovered model, and
  // outranks local on priority — the local router must STILL never pick it.
  const fleet = new FleetRegistry(
    new ProviderRegistry([local(), cloud()], () => 'present-key'),
    new ModelRegistry({ sources: [], staticModels: [m('local-coder', 'local'), m('claude-opus', 'anthropic')] }),
    { now: () => 1 },
  );
  const engine = new PolicyEngine();
  // Attach the cloud model to the cloud provider id so it is NOT folded into local.
  for (const policy of Object.keys(EXECUTION_POLICIES) as ExecutionPolicyId[]) {
    const d = await selectLocalCoding({ fleet, engine, policy }, { preferCoding: true, consentExternal: true });
    if (d.localModel) {
      assert.equal(d.localModel.provider, 'local', `policy ${policy} must target a local model, got ${d.localModel.provider}`);
      assert.notEqual(d.localModel.id, 'claude-opus', `policy ${policy} must never target the cloud model`);
    }
  }
});

test('INVARIANT: the local routing + assessment sources issue NO completion / cloud call', () => {
  const dir = path.join(process.cwd(), 'src', 'engine', 'providers');
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const forbidden = [/chat\/completions/, /\.complete\(/, /\.stream\(/, /\bfetch\(/, /anthropic\.com/, /api\.openai/];
  for (const file of ['localCodingRouter.ts', 'codingAssessment.ts']) {
    const src = stripComments(readFileSync(path.join(dir, file), 'utf8'));
    for (const re of forbidden) assert.ok(!re.test(src), `${file} must not contain ${re} (no cloud/completion in the local router)`);
  }
});
