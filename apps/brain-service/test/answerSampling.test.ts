/**
 * 🚨 TWO DEFECTS, ONE NUMBER. Both model calls in `agenticAnswer` ran at
 * temperature 0.1 — right for one of them, wrong for the other.
 *
 *   · "Try again" returned a BYTE-IDENTICAL answer. A control labelled "ask
 *     this question again for another answer" that cannot produce another one
 *     is a dead control.
 *   · Long-form generation collapsed into repetition. Measured while evaluating
 *     Haitian Creole: at temperature 0 every model looped one clause, and at
 *     0.7 the same model produced coherent prose.
 *
 * The TOOL call stays deterministic — a decision should be the same decision
 * every time, and its output is parsed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/engine/agents/agenticAnswer.ts', import.meta.url)),
  'utf8',
);

test('the answer turn does not sample near-deterministically', () => {
  const m = /const ANSWER_SAMPLING = \{ temperature: ([0-9.]+)/.exec(source);
  assert.ok(m, 'the answer turn must name its sampling');
  const t = Number(m[1]);
  assert.ok(t >= 0.5, `an answer turn at temperature ${t} cannot produce a second answer`);
  assert.ok(t <= 1.0, `temperature ${t} is past useful variety and into noise`);
});

test('the streaming answer uses it, and does not carry its own number', () => {
  assert.match(source, /stream: true, options: ANSWER_SAMPLING/);
});

test('🚨 the TOOL call stays deterministic', () => {
  /*
   * Tool selection is a decision whose output is parsed. Sampling it would make
   * the same question reach different capabilities on different days.
   */
  assert.match(source, /\.\.\.\(offeredTools \? \{ tools: offeredTools \} : \{\}\),\s*\n\s*options: \{ temperature: 0\.1 \}/);
});
