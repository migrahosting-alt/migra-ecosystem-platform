import assert from 'node:assert/strict';
import test from 'node:test';
import { decideRoute } from '../src/router/policy.js';

test('commit requests stay on cheap profile', () => {
  const result = decideRoute({
    feature: 'commit',
    userPrompt: 'Write a commit message for my changes',
  });

  assert.equal(result.modelProfile, 'cheap');
  assert.equal(result.allowEscalation, false);
});

test('fix requests use default profile', () => {
  const result = decideRoute({
    feature: 'fix',
    userPrompt: 'Fix this type error',
    signals: { hasDiagnostics: true },
  });

  assert.equal(result.modelProfile, 'default');
  assert.equal(result.retrievalMode, 'standard');
});