/*
 * Runner for the `chat.general` qualification suite.
 *
 * Every candidate goes through THIS path — same cases, same graders, same
 * replication, same threshold. There are no model-specific branches, because a
 * per-model exception is how a suite quietly stops measuring the contract and
 * starts measuring whether we like the answer.
 *
 * Emits an evidence package rather than a score: identity, digest, runtime,
 * hardware, both revisions, every case outcome, replication detail, and the
 * failures in full. A number without those cannot be re-derived by anyone else,
 * and evidence that cannot be re-derived is an opinion.
 */

import { CHAT_GENERAL_CASES, COVERED_DIMENSIONS, SUITE_REVISION, type Dimension } from './cases.js';
import {
  DIMENSION_MINIMUMS,
  REPLICATION_RUNS,
  THRESHOLD_REVISION,
  verdictFor,
  type DimensionScore,
  type SuiteVerdict,
} from './threshold.js';

export interface RunnerOptions {
  baseUrl: string;
  model: string;
  /** Identity of the machine that actually executed this. */
  hardware: string;
  runtime: string;
  modelDigest: string;
  timeoutMs?: number;
}

export interface CaseOutcome {
  id: string;
  dimension: Dimension;
  passed: boolean;
  /** How many replications passed, out of how many were run. */
  runs: { passed: number; total: number };
  /** Kept in full for failures — a failure with no transcript is unactionable. */
  answers: string[];
  intent: string;
}

export interface EvidencePackage {
  capability: 'chat.general';
  suiteRevision: string;
  thresholdRevision: string;
  candidate: { model: string; digest: string; runtime: string; hardware: string };
  startedAt: string;
  finishedAt: string;
  cases: CaseOutcome[];
  verdict: SuiteVerdict;
  failures: CaseOutcome[];
  /** Reported separately: these validate the run itself, not the candidate. */
  negativeControls: CaseOutcome[];
}

async function ask(opts: RunnerOptions, turns: string[]): Promise<string> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let last = '';
  for (const turn of turns) {
    messages.push({ role: 'user', content: turn });
    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: opts.model, messages, max_tokens: 700 }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from provider`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    last = body.choices?.[0]?.message?.content ?? '';
    // The whole exchange is replayed, so a multi-turn case tests real continuity
    // rather than a model re-reading one concatenated prompt.
    messages.push({ role: 'assistant', content: last });
  }
  return last;
}

export async function runChatGeneralSuite(opts: RunnerOptions): Promise<EvidencePackage> {
  const startedAt = new Date().toISOString();
  const outcomes: CaseOutcome[] = [];

  for (const testCase of CHAT_GENERAL_CASES) {
    // Replicate only where variance is behaviour rather than noise.
    const total = testCase.replicate ? REPLICATION_RUNS : 1;
    const answers: string[] = [];
    let passed = 0;
    for (let i = 0; i < total; i += 1) {
      let answer = '';
      try {
        answer = await ask(opts, testCase.turns);
      } catch (err) {
        answer = `<<error: ${(err as Error).message}>>`;
      }
      answers.push(answer);
      // A thrown provider error is a FAILED case, never a skipped one: a
      // candidate that cannot answer has not met the contract.
      if (!answer.startsWith('<<error:') && testCase.grade(answer, answers)) passed += 1;
    }
    outcomes.push({
      id: testCase.id,
      dimension: testCase.dimension,
      // Majority for replicated cases; a single pass otherwise.
      passed: passed > total / 2,
      runs: { passed, total },
      answers,
      intent: testCase.intent,
    });
  }

  const dimensions: DimensionScore[] = COVERED_DIMENSIONS.map((dimension) => {
    const inDim = outcomes.filter((o) => o.dimension === dimension);
    const passedCount = inDim.filter((o) => o.passed).length;
    const rate = inDim.length ? passedCount / inDim.length : 0;
    return {
      dimension,
      passed: passedCount,
      total: inDim.length,
      rate,
      meetsFloor: rate >= DIMENSION_MINIMUMS[dimension],
    };
  });

  const overallRate = outcomes.filter((o) => o.passed).length / outcomes.length;

  return {
    capability: 'chat.general',
    suiteRevision: SUITE_REVISION,
    thresholdRevision: THRESHOLD_REVISION,
    candidate: {
      model: opts.model,
      digest: opts.modelDigest,
      runtime: opts.runtime,
      hardware: opts.hardware,
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    cases: outcomes,
    verdict: verdictFor(dimensions, overallRate),
    failures: outcomes.filter((o) => !o.passed),
    negativeControls: outcomes.filter((o) => o.dimension === 'negative_control'),
  };
}
