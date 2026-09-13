/**
 * The runner, with a stubbed model — so the harness itself is tested before it
 * is trusted to judge anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runSuite, type RunnerDeps } from '../src/eval/reasoningDeep/run.js';
import type { Case } from '../src/eval/reasoningDeep/cases.js';

const candidate = {
  model: 'stub', digest: 'sha256:' + 'a'.repeat(64), provider: 'ollama',
  hosting: 'on-device' as const, license: 'apache-2.0', licenseSource: 'manifest',
  runtime: 'ollama-test', hardware: 'test',
};

const twoCases: Case[] = [
  { id: 'ok', dimension: 'stateful_numeric', prompt: 'p', trap: 'a trap that is named properly', check: (r) => r.includes('good') },
  { id: 'nc', dimension: 'negative_control', prompt: 'p', trap: 'another properly named trap', check: (r) => r.includes('good') },
];

const deps = (outcomes: string[], text = 'good'): RunnerDeps => {
  let i = 0;
  return {
    generate: async () => {
      const outcome = (outcomes[i % outcomes.length] ?? 'completed') as never;
      i += 1;
      return { text: outcome === 'completed' ? text : '', outcome, ms: 100 };
    },
    readVram: async () => ({ atMs: 0, modelBytes: 15e9, totalBytes: 15e9, residentModels: 1 }),
    sampleIntervalMs: 10_000,
  };
};

test('a clean run scores and records provenance', async () => {
  const pkg = await runSuite(deps(['completed']), {
    model: 'stub', replications: 2, candidate, contention: 'idle', cases: twoCases,
  });
  assert.equal(pkg.coverage, 1);
  assert.equal(pkg.capability, 'reasoning.deep');
  assert.equal(pkg.candidate.digest, candidate.digest);
  assert.ok(pkg.suiteRevision && pkg.thresholdRevision && pkg.policyVersion);
  // Unmeasured dimensions mean this cannot pass, which is correct.
  assert.equal(pkg.verdict.passed, false);
  assert.ok(pkg.verdict.unmeasured.length > 0);
});

test('🚨 timeouts leave the denominator and are visible as coverage', async () => {
  const pkg = await runSuite(deps(['completed', 'timeout']), {
    model: 'stub', replications: 2, candidate, contention: 'idle', cases: twoCases,
  });
  assert.equal(pkg.coverage, 0.5);
  // Which dimension receives the timeouts depends on case order, so assert the
  // property rather than the arrangement: some dimension recorded them, and no
  // dimension counted them as failures.
  assert.ok(pkg.dimensions.some((d) => d.notScored > 0), 'timeouts must be recorded somewhere');
  for (const d of pkg.dimensions) {
    if (d.rate !== null) assert.equal(d.rate, 1, `${d.dimension} counted a timeout against the model`);
  }
  // Nothing that timed out was marked wrong.
  assert.ok(pkg.runs.filter((r) => r.outcome === 'timeout').every((r) => r.verdict === 'not_scored'));
});

test('🚨 a complete response with no content is EMPTY, not a wrong answer', async () => {
  const pkg = await runSuite(deps(['completed'], '   '), {
    model: 'stub', replications: 1, candidate, contention: 'idle', cases: twoCases,
  });
  assert.ok(pkg.runs.every((r) => r.outcome === 'empty' && r.verdict === 'not_scored'));
});

test('cold and warm latency are separated', async () => {
  const pkg = await runSuite(deps(['completed']), {
    model: 'stub', replications: 2, candidate, contention: 'idle', cases: twoCases,
  });
  assert.equal(pkg.latency.coldMs.length, 1, 'exactly one run is the cold one');
  assert.ok(pkg.latency.warmMedianMs !== null);
});

test('transcripts are kept in full, including for passes', async () => {
  const pkg = await runSuite(deps(['completed'], 'good answer here'), {
    model: 'stub', replications: 1, candidate, contention: 'idle', cases: twoCases,
  });
  assert.ok(pkg.runs.every((r) => r.transcript.includes('good answer here')));
});

test('a transport failure does not throw the run away', async () => {
  const pkg = await runSuite({
    generate: async () => { throw new Error('connection refused'); },
    readVram: async () => null,
    sampleIntervalMs: 10_000,
  }, { model: 'stub', replications: 1, candidate, contention: 'idle', cases: twoCases });
  assert.ok(pkg.runs.every((r) => r.outcome === 'transport_error' && r.verdict === 'not_scored'));
  assert.equal(pkg.coverage, 0);
  assert.equal(pkg.verdict.passed, false);
});

test('contention is recorded, because an idle GPU is not the product world', async () => {
  const pkg = await runSuite(deps(['completed']), {
    model: 'stub', replications: 1, candidate, contention: 'workstation background floor', cases: twoCases,
  });
  assert.equal(pkg.contention, 'workstation background floor');
});
