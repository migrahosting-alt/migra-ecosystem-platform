// Intelligent Provider Router — Slice 1, commit 2: fleet registry.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import type { Provider } from '../src/engine/providers/types.js';
import type { ProviderProbe } from '../src/engine/providers/health.js';

const CAPS = { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true };
function prov(over: Partial<Provider> = {}): Provider {
  return { id: 'local', displayName: 'Local', kind: 'local', protocol: 'openai-compat', baseUrl: 'http://x/v1', capabilities: { ...CAPS, vision: true, embedding: true }, priority: 100, cost: { inputPer1M: 0, outputPer1M: 0 }, dataLocality: 'on-device', enabled: true, ...over };
}
function model(over: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return { id: 'qwen', provider: 'local', capabilities: { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false }, tier: 'balanced', ...over };
}
function models(list: ModelDescriptor[]): ModelRegistry {
  return new ModelRegistry({ sources: [], staticModels: list });
}
const now = () => 5000;

test('snapshot joins providers with their discovered models', async () => {
  const reg = new ProviderRegistry([prov()]);
  const fleet = new FleetRegistry(reg, models([model({ id: 'a' }), model({ id: 'b' })]), { now });
  const snap = await fleet.snapshot();
  assert.equal(snap.providers.length, 1);
  assert.deepEqual(snap.providers[0]!.models.map((m) => m.id), ['a', 'b']);
});

test('capability reconciliation: effective narrows declared to model evidence', async () => {
  const reg = new ProviderRegistry([prov()]); // declares vision + embedding true
  // discovered model backs neither vision nor embedding
  const fleet = new FleetRegistry(reg, models([model()]), { now });
  const fp = (await fleet.snapshot()).providers[0]!;
  assert.equal(fp.declaredCapabilities.vision, true);
  assert.equal(fp.modelBackedCapabilities.vision, false);
  assert.equal(fp.effectiveCapabilities.vision, false, 'effective narrowed to evidence');
  assert.equal(fp.effectiveCapabilities.coding, true);
});

test('a provider with NO discovered models keeps declared capabilities (no evidence to narrow)', async () => {
  const reg = new ProviderRegistry([prov({ id: 'anthropic', kind: 'cloud', enabled: true, credentialEnv: undefined })]);
  const fleet = new FleetRegistry(reg, models([]), { now });
  const fp = (await fleet.snapshot()).providers[0]!;
  assert.equal(fp.models.length, 0);
  assert.deepEqual(fp.effectiveCapabilities, fp.declaredCapabilities);
});

test('refresh probes enabled+credentialed providers and records truthful health', async () => {
  const probe: ProviderProbe = async (p) => (p.id === 'local' ? { reachable: true, modelCount: 2, latencyMs: 5 } : { reachable: false });
  const reg = new ProviderRegistry([prov(), prov({ id: 'openai', kind: 'cloud', enabled: true, credentialEnv: 'K' })], () => 'present-key');
  const fleet = new FleetRegistry(reg, models([]), { probe, now });
  await fleet.refresh();
  const h = fleet.healthById();
  assert.equal(h.get('local')!.status, 'healthy');
  assert.equal(h.get('openai')!.status, 'unreachable');
});

test('a disabled or missing-credential provider is NEVER probed', async () => {
  let probed = 0;
  const probe: ProviderProbe = async () => { probed += 1; return { reachable: true, modelCount: 1 }; };
  const reg = new ProviderRegistry(
    [prov({ id: 'disabled', enabled: false }), prov({ id: 'openai', kind: 'cloud', enabled: true, credentialEnv: 'MISSING' })],
    () => undefined, // no env vars present → credential absent
  );
  const fleet = new FleetRegistry(reg, models([]), { probe, now });
  await fleet.refresh();
  assert.equal(probed, 0, 'neither disabled nor missing-credential providers are probed');
  const h = fleet.healthById();
  assert.equal(h.get('disabled')!.status, 'disabled');
  assert.equal(h.get('openai')!.status, 'unknown');
  assert.equal(h.get('openai')!.detail, 'credential absent');
});

test('an unreachable provider is still listed truthfully (never dropped)', async () => {
  const probe: ProviderProbe = async () => { throw new Error('ECONNREFUSED'); };
  const reg = new ProviderRegistry([prov()]);
  const fleet = new FleetRegistry(reg, models([]), { probe, now });
  await fleet.refresh();
  const snap = await fleet.snapshot();
  assert.equal(snap.providers[0]!.provider.health.status, 'unreachable');
});
