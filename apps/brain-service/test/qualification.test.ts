import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QualificationStore } from '../src/engine/qualificationStore.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import { selectModel } from '../src/engine/capabilityRouter.js';

function model(id: string, tier: ModelDescriptor['tier'], caps: Partial<ModelDescriptor['capabilities']> = {}): ModelDescriptor {
  return {
    id, provider: 'ollama', tier,
    capabilities: { chat: true, vision: false, tools: false, embedding: false, reasoning: false, coding: false, insert: false, ...caps },
  };
}

function registry(qual: QualificationStore, models: ModelDescriptor[]): ModelRegistry {
  return new ModelRegistry({ sources: [], staticModels: models, qualify: (id) => qual.get(id) });
}

const MODELS = [
  model('approved-fast', 'fast', { coding: true }),
  model('installed-fast', 'fast', { coding: true }),
  model('rejected-fast', 'fast', { coding: true }),
];

test('QualificationStore: defaults, states, enforced flag, missing file', () => {
  const q = new QualificationStore({ mode: 'enforced', models: { 'a': { state: 'approved' }, 'b': { state: 'rejected' } } });
  assert.equal(q.enforced, true);
  assert.equal(q.get('a').state, 'approved');
  assert.equal(q.isApproved('a'), true);
  assert.equal(q.isRejected('b'), true);
  assert.equal(q.get('unknown').state, 'installed', 'unlisted installed model is not approved');
  const missing = QualificationStore.fromFile('/no/such/file.json');
  assert.equal(missing.enforced, false, 'absent manifest is permissive (fail-open on start, gate off)');
});

test('registry attaches qualification to descriptors', async () => {
  const q = new QualificationStore({ models: { 'approved-fast': { state: 'approved', tier: 'fast' } } });
  const models = await registry(q, MODELS).list();
  assert.equal(models.find((m) => m.id === 'approved-fast')!.qualification!.state, 'approved');
  assert.equal(models.find((m) => m.id === 'installed-fast')!.qualification!.state, 'installed');
});

test('router: enforced production serves ONLY approved', async () => {
  const q = new QualificationStore({ mode: 'enforced', models: { 'approved-fast': { state: 'approved' }, 'rejected-fast': { state: 'rejected' } } });
  const reg = registry(q, MODELS);
  const d = await selectModel(reg, { tier: 'fast', enforce: q.enforced, mode: 'production' });
  assert.equal(d!.model.id, 'approved-fast', 'installed + rejected excluded in enforced production');
});

test('router: rejected NEVER served, even in evaluation or permissive', async () => {
  const q = new QualificationStore({ mode: 'enforced', models: { 'rejected-fast': { state: 'rejected' } } });
  const reg = registry(q, [model('rejected-fast', 'fast', { coding: true })]);
  assert.equal(await selectModel(reg, { tier: 'fast', enforce: true, mode: 'evaluation' }), null);
  assert.equal(await selectModel(reg, { tier: 'fast', enforce: false }), null, 'rejected excluded even permissively');
});

test('router: evaluation mode serves installed (non-approved, non-rejected)', async () => {
  const q = new QualificationStore({ mode: 'enforced', models: { 'rejected-fast': { state: 'rejected' } } });
  const reg = registry(q, MODELS);
  const d = await selectModel(reg, { tier: 'fast', enforce: true, mode: 'evaluation' });
  assert.ok(d && d.model.id !== 'rejected-fast', 'evaluation can use installed models, but not rejected');
});

test('router: permissive (enforce off) serves any non-rejected — pre-qualification behavior', async () => {
  const q = new QualificationStore({ models: {} }); // permissive
  const reg = registry(q, MODELS);
  const d = await selectModel(reg, { tier: 'fast', enforce: q.enforced });
  assert.ok(d, 'without enforcement the router behaves as before');
});

test('router: enforced production with NO approved model → null (fail closed, no silent downgrade)', async () => {
  const q = new QualificationStore({ mode: 'enforced', models: {} }); // nothing approved
  const reg = registry(q, MODELS);
  assert.equal(await selectModel(reg, { tier: 'fast', enforce: true, mode: 'production' }), null);
});

test('deprecated: distinct provenance from rejected, but never served (default retirement)', () => {
  const q = new QualificationStore({ mode: 'enforced', models: { old: { state: 'deprecated' }, bad: { state: 'rejected' } } });
  assert.equal(q.isDeprecated('old'), true);
  assert.equal(q.isDeprecated('bad'), false, 'rejected is not deprecated');
  assert.equal(q.isApproved('old'), false, 'a retired model is not approved');
  // Both are never-serve, so a retired model can never silently return as a default.
  assert.equal(q.isRejected('old'), true, 'deprecated is caught by the never-serve gate');
  assert.equal(q.isRejected('bad'), true);
});

test('router: a deprecated vision model is retired; an approved successor is chosen', async () => {
  const q = new QualificationStore({
    mode: 'enforced',
    models: { 'llava-old': { state: 'deprecated' }, 'qwen-vl': { state: 'approved', tier: 'vision' } },
  });
  const reg = registry(q, [
    model('llava-old', 'balanced', { vision: true }),
    model('qwen-vl', 'balanced', { vision: true }),
  ]);
  const d = await selectModel(reg, { needsVision: true, tier: 'balanced', enforce: true, mode: 'production' });
  assert.equal(d!.model.id, 'qwen-vl', 'the qualified successor serves vision, never the deprecated model');
  // Even in evaluation mode a retired model does not come back.
  const evalPick = await selectModel(reg, { needsVision: true, tier: 'balanced', enforce: true, mode: 'evaluation' });
  assert.notEqual(evalPick?.model.id, 'llava-old', 'deprecated stays retired even in evaluation');
});

test('router: deprecating the ONLY vision model fails closed (no vision) — never a silent retired fallback', async () => {
  const q = new QualificationStore({ mode: 'enforced', models: { 'llava-old': { state: 'deprecated' } } });
  const reg = registry(q, [model('llava-old', 'balanced', { vision: true })]);
  assert.equal(
    await selectModel(reg, { needsVision: true, tier: 'balanced', enforce: true, mode: 'production' }),
    null,
    'better no vision than silently serving a retired model',
  );
});
