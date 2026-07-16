import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatAttachment } from '@migrapilot/shared-types';
import { buildAiRequest, profileToTier, turnNeedsVision } from '../../chat/intentMapping.js';

test('profileToTier maps UI profiles to engine tiers', () => {
  assert.equal(profileToTier('cheap'), 'fast');
  assert.equal(profileToTier('default'), 'balanced');
  assert.equal(profileToTier('premium'), 'deep');
  assert.equal(profileToTier(undefined), undefined);
});

test('normal chat requests no coding/reasoning and never names a model', () => {
  const req = buildAiRequest('hello there', { feature: 'chat', modelProfile: 'default' });
  assert.equal(req.preferCoding, false);
  assert.equal(req.needsReasoning, false);
  assert.equal(req.tier, 'balanced');
  assert.equal('model' in req, false, 'extension must not name a concrete model');
});

test('code explanation reaches the engine with coding capability requested', () => {
  const req = buildAiRequest('explain this function', { feature: 'explain', modelProfile: 'cheap' });
  assert.equal(req.preferCoding, true);
  assert.equal(req.tier, 'fast');
  assert.equal('model' in req, false);
});

test('deeper reasoning (premium/deep) requests reasoning capability', () => {
  const req = buildAiRequest('think hard about this', { feature: 'chat', modelProfile: 'premium' });
  assert.equal(req.tier, 'deep');
  assert.equal(req.needsReasoning, true);
});

test('image request carries attachments and never names a concrete model', () => {
  const attachments: ChatAttachment[] = [{ name: 'a.png', mimeType: 'image/png', dataBase64: 'AAAA' }];
  assert.equal(turnNeedsVision(attachments), true);
  assert.equal(turnNeedsVision([{ name: 'a.txt', mimeType: 'text/plain', dataBase64: 'AAAA' }]), false);
  const req = buildAiRequest('what is in this image?', { feature: 'chat', attachments });
  assert.deepEqual(req.attachments, attachments);
  assert.equal('model' in req, false, 'vision turns must not name a model — engine picks the vision model');
});

test('fix/review/test also request coding capability', () => {
  for (const feature of ['fix', 'review', 'test'] as const) {
    assert.equal(buildAiRequest('x', { feature }).preferCoding, true, feature);
  }
});
