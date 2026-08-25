/**
 * The engine's half of a turn's trace.
 *
 * Written because the consumer's trace could see a real 89.8s stage and nothing
 * inside it. What matters here is that the line names the ONE stage that stage
 * actually was, and that a failed turn still produces a line.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BrainTurnTrace } from '../src/engine/turnTrace.js';

const busy = (ms: number): void => {
  const until = performance.now() + ms;
  while (performance.now() < until) { /* a real duration, not a faked clock */ }
};

test('a stage reports time spent inside it, which is what makes a slow one findable', () => {
  const lines: string[] = [];
  const trace = new BrainTurnTrace('req_aaaaaaaaaaaaaaaaaaaa', (l) => lines.push(l));

  trace.mark('audit');
  busy(25);
  trace.mark('route');
  busy(5);
  trace.mark('upstream_open');
  const built = trace.build('ok');

  assert.ok(built.ms.route! >= 20, `route was ${built.ms.route}`);
  assert.ok(built.ms.upstream_open! < built.ms.route!, 'each stage is its own duration');
  assert.ok(built.at_ms.upstream_open! >= built.at_ms.route!, 'at_ms accumulates');
});

test('the line carries the same id the consumer used, so one grep spans both', () => {
  const lines: string[] = [];
  const shared = 'req_d9ba7095c5ad7ab11016';
  const trace = new BrainTurnTrace(shared, (l) => lines.push(l));
  trace.set('model', 'qwen3:8b');
  trace.mark('route');
  trace.finish('ok');

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!.slice('migrapilot.brain.turn '.length)) as Record<string, unknown>;
  assert.equal(parsed.trace, shared);
  assert.equal(parsed.model, 'qwen3:8b');
  // A distinct prefix from the consumer's line: one grep can take both or either.
  assert.ok(lines[0]!.startsWith('migrapilot.brain.turn '));
});

test('a value containing a newline cannot forge a second line', () => {
  const lines: string[] = [];
  const trace = new BrainTurnTrace('req_bbbbbbbbbbbbbbbbbbbb', (l) => lines.push(l));
  trace.set('model', 'evil\nmigrapilot.brain.turn {"trace":"forged"}');
  trace.finish('ok');
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.split('\n').length, 1);
});

test('finish is idempotent so a failure path can guarantee a line', () => {
  const lines: string[] = [];
  const trace = new BrainTurnTrace('req_cccccccccccccccccccc', (l) => lines.push(l));
  trace.finish('completion_failed');
  trace.finish('ok');
  assert.equal(lines.length, 1, 'one turn is one line');
  const parsed = JSON.parse(lines[0]!.slice('migrapilot.brain.turn '.length)) as { outcome: string };
  assert.equal(parsed.outcome, 'completion_failed', 'the specific outcome wins over the catch-all');
});
