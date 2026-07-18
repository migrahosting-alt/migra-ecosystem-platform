// Intelligent Provider Router — Slice 1, commit 1: provider registry + health.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { declareProviders, buildProviderRegistry } from '../src/engine/providers/config.js';
import { deriveHealth } from '../src/engine/providers/health.js';
import type { Provider } from '../src/engine/providers/types.js';

function prov(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p', displayName: 'P', kind: 'cloud', protocol: 'openai-compat', baseUrl: 'https://x/v1',
    credentialEnv: 'X_KEY', capabilities: { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true },
    priority: 10, cost: { inputPer1M: 1, outputPer1M: 2 }, dataLocality: 'external', enabled: true, ...over,
  };
}

test('default declaration: local enabled, both cloud providers DISABLED by default', () => {
  const providers = declareProviders({});
  const byId = new Map(providers.map((p) => [p.id, p]));
  assert.equal(byId.get('local')!.enabled, true);
  assert.equal(byId.get('local')!.dataLocality, 'on-device');
  assert.equal(byId.get('openai')!.enabled, false);
  assert.equal(byId.get('anthropic')!.enabled, false);
  assert.equal(byId.get('anthropic')!.protocol, 'anthropic');
});

test('cloud providers enable only via explicit env flag', () => {
  const providers = declareProviders({ MIGRAPILOT_PROVIDER_OPENAI_ENABLED: 'true', MIGRAPILOT_PROVIDER_ANTHROPIC_ENABLED: '1' });
  const byId = new Map(providers.map((p) => [p.id, p]));
  assert.equal(byId.get('openai')!.enabled, true);
  assert.equal(byId.get('anthropic')!.enabled, true);
});

test('credential presence is a boolean derived from the env var NAME — never the value', () => {
  const reg = buildProviderRegistry({ MIGRAPILOT_PROVIDER_OPENAI_ENABLED: 'true', OPENAI_API_KEY: 'sk-secret-value' });
  const openai = reg.get('openai')!;
  assert.equal(reg.hasCredential(openai), true);
  // anthropic has no key set → false.
  assert.equal(reg.hasCredential(reg.get('anthropic')!), false);
  // local has no credentialEnv → always credentialed.
  assert.equal(reg.hasCredential(reg.get('local')!), true);
  // The value never surfaces through a summary.
  const flat = JSON.stringify(reg.summaries(new Map()));
  assert.ok(!flat.includes('sk-secret-value'));
  assert.ok(flat.includes('OPENAI_API_KEY')); // env NAME is safe to show
});

test('registry lists by priority desc and filters enabled', () => {
  const reg = new ProviderRegistry([prov({ id: 'a', priority: 10 }), prov({ id: 'b', priority: 20 }), prov({ id: 'c', priority: 5, enabled: false })]);
  assert.deepEqual(reg.list().map((p) => p.id), ['b', 'a', 'c']);
  assert.deepEqual(reg.enabled().map((p) => p.id), ['b', 'a']);
});

test('deriveHealth is truthful: disabled / missing-credential / unprobed / unreachable / healthy / degraded', () => {
  const now = 1000;
  assert.equal(deriveHealth(prov({ enabled: false }), true, null, now).status, 'disabled');
  assert.equal(deriveHealth(prov(), false, null, now).status, 'unknown'); // credential absent
  assert.equal(deriveHealth(prov(), true, null, now).status, 'unknown'); // not yet probed
  assert.equal(deriveHealth(prov(), true, { reachable: false, detail: 'timeout' }, now).status, 'unreachable');
  assert.equal(deriveHealth(prov(), true, { reachable: true, modelCount: 3 }, now).status, 'healthy');
  assert.equal(deriveHealth(prov(), true, { reachable: true, modelCount: 0 }, now).status, 'degraded');
});

test('deriveHealth never fabricates healthy and never leaks the credential value', () => {
  const h = deriveHealth(prov(), false, null, 1);
  assert.equal(h.detail, 'credential absent');
  assert.ok(!JSON.stringify(h).includes('sk-'));
});
