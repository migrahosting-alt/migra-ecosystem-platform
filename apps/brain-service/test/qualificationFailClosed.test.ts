/**
 * A broken qualification manifest must not disable the gate.
 *
 * The old behaviour returned a PERMISSIVE store for anything it could not read,
 * so a typo in the manifest silently switched off the control that decides which
 * models may serve users — and nothing said so. That is the wrong direction of
 * failure for a safety control.
 *
 * Absent and unreadable are deliberately different: a deployment that never
 * adopted qualification must still start.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { QualificationStore } from '../src/engine/qualificationStore.js';

const dir = mkdtempSync(join(tmpdir(), 'qual-'));

test('a MISSING manifest is permissive — qualification was never configured', () => {
  const store = QualificationStore.fromFile(join(dir, 'nothing-here.json'));
  assert.equal(store.enforced, false);
});

test('a CORRUPT manifest fails closed: enforced, with nothing approved', () => {
  /*
   * Someone configured a gate and it is broken. Answering that by serving
   * everything is the failure this test exists to prevent.
   */
  const path = join(dir, 'broken.json');
  writeFileSync(path, '{ this is not json at all ');
  const store = QualificationStore.fromFile(path);

  assert.equal(store.enforced, true, 'a broken gate must still be a gate');
  assert.equal(store.isApproved('qwen2.5vl:7b'), false, 'nothing is approved by a manifest nobody could read');
});

test('an empty-but-valid manifest is honoured as written', () => {
  const path = join(dir, 'empty.json');
  writeFileSync(path, JSON.stringify({ mode: 'enforced', models: {} }));
  const store = QualificationStore.fromFile(path);
  assert.equal(store.enforced, true);
  assert.equal(store.isApproved('anything'), false);
});

test('a valid manifest still approves what it lists', () => {
  const path = join(dir, 'good.json');
  writeFileSync(path, JSON.stringify({
    mode: 'enforced',
    models: { 'qwen2.5vl:7b': { state: 'approved' } },
  }));
  const store = QualificationStore.fromFile(path);
  assert.equal(store.isApproved('qwen2.5vl:7b'), true);
  assert.equal(store.isApproved('llava:latest'), false);
});
