/**
 * A model that runs on someone else's hardware must not be served as local.
 *
 * ---------------------------------------------------------------------------
 * 🚨 MEASURED ON STAGING, NOT HYPOTHESISED
 *
 * A `tier: deep` chat turn against the staging Brain returned:
 *
 *   model    gpt-oss:120b-cloud
 *   provider local
 *   usage    { inputTokens: 335, outputTokens: 73 }
 *
 * 335 tokens of user prompt left the machine. Ollama lists its cloud models
 * through the same local `/api/tags` endpoint as the ones on disk, so the
 * descriptor inherited `provider: 'ollama'`, and the `local` provider is
 * declared with `dataLocality: 'on-device'` and `cost: 0`. Both claims were
 * false and nothing anywhere said so.
 *
 * It also wins the deep tier outright: the router's deep-tier score adds
 * `paramCount * 0.05`, so 116.8B parameters beats every on-device model by a
 * margin no other signal can close.
 *
 * The rule this protects is already written down — "owned → open-source →
 * self-hosted → free tier → partner credits → paid. No recurring paid
 * dependency enters quietly."
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelRegistry, isRemotelyHosted, type ModelDescriptor } from '../src/engine/models/modelRegistry.js';

// The two real entries, verbatim from the workstation's /api/tags.
const CLOUD = { name: 'gpt-oss:120b-cloud', size: 384, details: { parameter_size: '116.8B', family: 'gptoss' } };
const LOCAL = { name: 'llama3.1:8b', size: 4_920_753_328, details: { parameter_size: '8.0B', family: 'llama' } };

function registry(opts: { allowRemote?: boolean } = {}) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ models: [CLOUD, LOCAL] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return new ModelRegistry({
    sources: [{ id: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' }],
    fetchImpl,
    ttlMs: 0,
    ...opts,
  });
}

test('the -cloud tag marks a model as remotely hosted', () => {
  assert.equal(isRemotelyHosted('gpt-oss:120b-cloud', 384, 116.8), true);
  assert.equal(isRemotelyHosted('llama3.1:8b', 4_920_753_328, 8), false);
});

test('an impossibly small manifest for its parameter count is remote, whatever it is called', () => {
  // Defence in depth: the naming convention is Ollama's and could change.
  assert.equal(isRemotelyHosted('someone-elses:70b', 512, 70), true);
  // A genuinely tiny model is NOT remote — 137M params in 274MB is on-device.
  assert.equal(isRemotelyHosted('nomic-embed-text:latest', 274_302_450, 0.137), false);
});

test('remote models are excluded from the catalog by default', async () => {
  const ids = (await registry().list(true)).map((m) => m.id);
  assert.deepEqual(ids, ['llama3.1:8b']);
  assert.equal(ids.includes('gpt-oss:120b-cloud'), false);
});

test('an operator can opt in explicitly, and then it is labelled honestly', async () => {
  const all = await registry({ allowRemote: true }).list(true);
  const cloud = all.find((m) => m.id === 'gpt-oss:120b-cloud');
  assert.ok(cloud, 'opting in must actually admit the model');
  assert.equal(cloud!.hosting, 'remote');
  const local = all.find((m) => m.id === 'llama3.1:8b') as ModelDescriptor;
  assert.equal(local.hosting, 'on-device');
});

test('excluding the cloud model does not empty the deep tier', async () => {
  // The point is that on-device deep models still exist. If this ever fails,
  // the exclusion has taken away a capability rather than a misrepresentation.
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        models: [CLOUD, { name: 'deepseek-r1:32b', size: 19_851_337_809, details: { parameter_size: '32.8B' } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
  const reg = new ModelRegistry({
    sources: [{ id: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' }],
    fetchImpl,
    ttlMs: 0,
  });
  const deep = (await reg.list(true)).filter((m) => m.tier === 'deep');
  assert.equal(deep.length, 1);
  assert.equal(deep[0]!.id, 'deepseek-r1:32b');
});
