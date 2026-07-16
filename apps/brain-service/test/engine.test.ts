import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelRegistry, parseParamSize, tierFor } from '../src/engine/modelRegistry.js';
import { selectModel, tierFromHints } from '../src/engine/capabilityRouter.js';

const TAGS_FIXTURE = {
  models: [
    { name: 'qwen2.5-coder:7b', size: 4_683_087_561, capabilities: ['completion', 'tools', 'insert'], details: { family: 'qwen2', parameter_size: '7.6B', context_length: 32768 } },
    { name: 'qwen2.5-coder:14b', size: 8_988_124_298, capabilities: ['completion', 'tools', 'insert'], details: { family: 'qwen2', parameter_size: '14.8B' } },
    { name: 'deepseek-r1:32b', size: 19_851_337_809, capabilities: ['completion', 'thinking'], details: { family: 'qwen2', parameter_size: '32.8B' } },
    { name: 'llava:latest', size: 4_733_363_377, capabilities: ['completion', 'vision'], details: { family: 'llama', parameter_size: '7B' } },
    { name: 'llama3.2-vision:11b', size: 7_816_589_186, capabilities: ['vision', 'completion'], details: { family: 'mllama', parameter_size: '10.7B' } },
    { name: 'nomic-embed-text:latest', size: 274_302_450, capabilities: ['embedding'], details: { family: 'nomic-bert', parameter_size: '137M' } },
  ],
};

function tagsFetch(): typeof fetch {
  return (async (url: string) => {
    if (String(url).endsWith('/api/tags')) {
      return { ok: true, json: async () => TAGS_FIXTURE } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

function registry(): ModelRegistry {
  return new ModelRegistry({
    sources: [{ id: 'local', baseUrl: 'http://x/v1' }],
    fetchImpl: tagsFetch(),
  });
}

test('parseParamSize + tierFor', () => {
  assert.equal(parseParamSize('7.6B'), 7.6);
  assert.equal(parseParamSize('137M'), 0.137);
  assert.equal(parseParamSize(undefined), undefined);
  assert.equal(tierFor(7), 'fast');
  assert.equal(tierFor(14), 'balanced');
  assert.equal(tierFor(32), 'deep');
  assert.equal(tierFor(undefined), 'balanced');
});

test('registry discovers + classifies capabilities from Ollama tags', async () => {
  const models = await registry().list(true);
  assert.equal(models.length, 6);
  const coder = models.find((m) => m.id === 'qwen2.5-coder:7b')!;
  assert.equal(coder.capabilities.coding, true);
  assert.equal(coder.capabilities.tools, true);
  assert.equal(coder.tier, 'fast');
  const r1 = models.find((m) => m.id === 'deepseek-r1:32b')!;
  assert.equal(r1.capabilities.reasoning, true);
  assert.equal(r1.tier, 'deep');
  const llava = models.find((m) => m.id === 'llava:latest')!;
  assert.equal(llava.capabilities.vision, true);
  const embed = models.find((m) => m.id === 'nomic-embed-text:latest')!;
  assert.equal(embed.capabilities.embedding, true);
  assert.equal(embed.capabilities.chat, false, 'embedding-only model is not a chat model');
});

test('router: vision turn selects a vision model', async () => {
  const d = await selectModel(registry(), { needsVision: true, tier: 'fast' });
  assert.ok(d);
  assert.equal(d!.model.capabilities.vision, true);
});

test('router: fast coding turn prefers a small coder', async () => {
  const d = await selectModel(registry(), { tier: 'fast', preferCoding: true });
  assert.ok(d);
  assert.equal(d!.model.id, 'qwen2.5-coder:7b');
});

test('router: deep reasoning turn selects the large reasoning model', async () => {
  const d = await selectModel(registry(), { tier: 'deep', needsReasoning: true });
  assert.ok(d);
  assert.equal(d!.model.id, 'deepseek-r1:32b');
});

test('router: embedding request selects the embedding model, chat requests never do', async () => {
  const embed = await selectModel(registry(), { needsEmbedding: true });
  assert.equal(embed!.model.id, 'nomic-embed-text:latest');
  const chat = await selectModel(registry(), { tier: 'balanced' });
  assert.notEqual(chat!.model.id, 'nomic-embed-text:latest');
});

test('router: explicit model override honored when present', async () => {
  const d = await selectModel(registry(), { model: 'qwen2.5-coder:14b', tier: 'fast' });
  assert.equal(d!.model.id, 'qwen2.5-coder:14b');
});

test('router: null when a required capability has no model', async () => {
  const empty = new ModelRegistry({
    sources: [{ id: 'local', baseUrl: 'http://x/v1' }],
    fetchImpl: (async () => ({ ok: true, json: async () => ({ models: [] }) })) as unknown as typeof fetch,
  });
  assert.equal(await selectModel(empty, { needsEmbedding: true }), null);
});

test('tierFromHints maps legacy profile/feature + explicit tier', () => {
  assert.equal(tierFromHints({ tier: 'deep' }), 'deep');
  assert.equal(tierFromHints({ profile: 'cheap' }), 'fast');
  assert.equal(tierFromHints({ profile: 'premium' }), 'deep');
  assert.equal(tierFromHints({ feature: 'commit' }), 'fast');
  assert.equal(tierFromHints({ feature: 'review' }), 'deep');
  assert.equal(tierFromHints({}), 'balanced');
});
