/**
 * Which visual operation may be served, and by what.
 *
 * The property under test is not "the classifier is clever". It is that a
 * question nothing is qualified for cannot be answered by a model that happens
 * to accept images.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { classifyVisualOperation, unqualifiedOperationMessage } from '../src/engine/media/visualOperation.js';
import { gateVisionTurn, visionCapabilitySnapshot } from '../src/engine/media/visionGate.js';

/** A store where only `vision.general` has a live approval — production's shape. */
function storeWith(approvals: Record<string, { modelId: string; digest?: string }>) {
  const client = {
    async query(text: string, params: unknown[] = []) {
      if (text.includes('FROM model_qualification_decisions')) {
        const cap = String(params[1] ?? params[0]);
        const hit = approvals[cap];
        return {
          rows: hit ? [{
            id: 'dec-1', model_id: hit.modelId, capability: cap, model_digest: hit.digest ?? null,
            model_version: null, state: 'approved', evidence_run_id: 'ev-1',
            approver_user_id: 'user:1', calling_service: 'cli', request_id: 'r1',
            note: null, decided_at: 1, revoked_at: null, revoked_by_user_id: null, revoked_reason: null,
          }] : [],
          rowCount: hit ? 1 : 0,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { transaction: <T,>(fn: (c: PoolClient) => Promise<T>) => fn(client) };
}

const QWEN = { modelId: 'qwen2.5vl:7b', digest: 'sha256:5ced39df' };

test('a counting question is not served by a model qualified only for general vision', async () => {
  /*
   * The failure this prevents: qwen answers 6 for seven circles, on every run,
   * with no hedge. Served as "vision", that is a confident wrong number.
   */
  const deps = storeWith({ 'vision.general': QWEN });
  const out = await gateVisionTurn(deps, 'Count exactly how many people are in this crowd.');
  assert.equal(out.serve, false);
  if (!out.serve) {
    assert.equal(out.capability, 'vision.object_counting');
    assert.equal(out.reason, 'no_qualified_model');
  }
});

test('a general question about the same image IS served', async () => {
  const deps = storeWith({ 'vision.general': QWEN });
  const out = await gateVisionTurn(deps, 'What is in this photo?');
  assert.equal(out.serve, true);
  if (out.serve) {
    assert.equal(out.capability, 'vision.general');
    assert.equal(out.modelId, 'qwen2.5vl:7b', 'the approved decision names the model');
  }
});

test('the refusal explains the limit and does not answer anyway', async () => {
  const message = unqualifiedOperationMessage('object_counting');
  assert.match(message, /exact count/i);
  assert.match(message, /not reliable/i);
  // A message that ended "but it looks like about seven" would undo the refusal.
  assert.doesNotMatch(message, /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i,
    'a refusal must not smuggle a number back in');
  assert.match(message, /ask me what is in the image/i, 'it offers what the model CAN do');
});

test('nothing approved means nothing served, not a fallback to whatever is installed', async () => {
  const deps = storeWith({});
  const out = await gateVisionTurn(deps, 'What does this screenshot say?');
  assert.equal(out.serve, false);
  if (!out.serve) assert.equal(out.reason, 'no_qualified_model');
});

test('a revoked approval takes effect on the next call, with nothing to invalidate', async () => {
  /*
   * The gate reads through to the table every time. A cached answer outlives the
   * revocation that should have ended it, and the moment you revoke is exactly
   * when that does the most damage.
   */
  const approvals: Record<string, { modelId: string }> = { 'vision.general': QWEN };
  const deps = storeWith(approvals);
  assert.equal((await gateVisionTurn(deps, 'What is this?')).serve, true);
  delete approvals['vision.general'];
  assert.equal((await gateVisionTurn(deps, 'What is this?')).serve, false);
});

test('the phrasings people actually type are recognised as counting', () => {
  for (const prompt of [
    'How many people are in this photo?',
    'Count the cars please',
    'What is the number of windows on the building?',
    'Give me a tally of the red items',
    'Exactly how many circles are there?',
    'Are there more than five chairs?',
  ]) {
    assert.equal(classifyVisualOperation(prompt).operation, 'object_counting', prompt);
  }
});

test('words that merely contain a counting word do not trigger a refusal', () => {
  /*
   * `\bcount\b` and not `count`: refusing to describe a kitchen because the word
   * "countertop" appeared would be the classifier failing in the annoying
   * direction for no safety gain.
   */
  for (const prompt of [
    'What is on the countertop in this photo?',
    'Which country is this flag from?',
    'Is there a discount shown on this receipt?',
    'Describe the account settings screen',
  ]) {
    assert.equal(classifyVisualOperation(prompt).operation, 'general', prompt);
  }
});

test('an empty or missing prompt is general, not counting', () => {
  // An attachment with no question is "look at this", and refusing it as a
  // counting request would block the most ordinary use of the feature.
  assert.equal(classifyVisualOperation(undefined).operation, 'general');
  assert.equal(classifyVisualOperation('').operation, 'general');
});

test('the capability snapshot answers per operation, not with one boolean', async () => {
  const snapshot = await visionCapabilitySnapshot(storeWith({ 'vision.general': QWEN }));
  assert.equal(snapshot.general.qualified, true);
  assert.equal(snapshot.general.modelId, 'qwen2.5vl:7b');
  assert.equal(snapshot.general.digest, 'sha256:5ced39df', 'approval is about exact bytes');
  assert.equal(snapshot.objectCounting.qualified, false, 'measured and failed — not merely absent');
});
