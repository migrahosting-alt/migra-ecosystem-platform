/**
 * Run the `reasoning.deep` suite and produce an evidence package.
 *
 * 🚨 THIS IS NOT AN APPROVAL TOOL. It measures and records. Nothing here writes
 * a qualification decision, and the package it emits is an input to a human
 * decision, not a substitute for one.
 *
 * The three properties the 2026-09-13 audit proved a harness needs:
 *
 *   · HARNESS OUTCOME AND MODEL VERDICT ARE SEPARATE FIELDS. A timeout is
 *     decisive about cost and silent about correctness, and `score()` throws
 *     rather than let the two be collapsed.
 *   · VRAM IS SAMPLED THROUGHOUT, not once at the end, so peak residency and
 *     load/unload churn are evidence rather than inference.
 *   · COLD AND WARM ARE REPORTED SEPARATELY. A first call includes weight
 *     loading and is not the latency a user experiences.
 */

import { CASES, type Case } from './cases.js';
import {
  DIMENSION_MINIMUMS, SUITE_REVISION, THRESHOLD_REVISION, POLICY_VERSION,
  verdictFor, type Dimension, type DimensionScore, type SuiteVerdict,
} from './threshold.js';
import {
  score, noResult, tally, coverage, isScored, MINIMUM_COVERAGE,
  type HarnessOutcome, type ItemResult,
} from '../outcome.js';
import { profile, startSampling, type VramProfile, type VramSample } from '../vramSampler.js';

export interface GenerateResult {
  text: string;
  /** The provider's own reason, mapped by the caller. */
  outcome: HarnessOutcome;
  ms: number;
}

export interface RunnerDeps {
  /** One generation. The caller owns transport, timeouts and outcome mapping. */
  generate: (model: string, prompt: string, budget: number) => Promise<GenerateResult>;
  /** One VRAM reading, or null when it could not be taken. */
  readVram: (model: string) => Promise<VramSample | null>;
  sampleIntervalMs?: number;
}

export interface CaseRun extends ItemResult {
  caseId: string;
  dimension: Dimension;
  replication: number;
  /** 🚨 Kept in full. A failure with no transcript is unactionable. */
  transcript: string;
  cold: boolean;
  vram: VramProfile;
}

export interface EvidencePackage {
  capability: 'reasoning.deep';
  suiteRevision: string;
  thresholdRevision: string;
  policyVersion: string;
  candidate: {
    model: string;
    /** 🚨 An approval is for bytes. Absent means it cannot be bound to one. */
    digest: string | undefined;
    provider: string;
    hosting: 'on-device' | 'remote' | 'unknown';
    license: string | undefined;
    licenseSource: string | undefined;
    runtime: string;
    hardware: string;
  };
  harness: { replications: number; defaultBudget: number; sampleIntervalMs: number };
  /** Whether anything else was running. An idle GPU is not the product's world. */
  contention: string;
  startedAt: string;
  finishedAt: string;
  runs: CaseRun[];
  dimensions: DimensionScore[];
  latency: {
    coldMs: number[];
    warmMedianMs: number | null;
    warmP95Ms: number | null;
  };
  vram: {
    peakModelBytes: number;
    peakTotalBytes: number;
    transitions: number;
    residencyRatio: number;
    sharedDevice: boolean;
  };
  coverage: number;
  verdict: SuiteVerdict;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const p95 = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!;
};

export interface RunOptions {
  model: string;
  replications: number;
  candidate: EvidencePackage['candidate'];
  contention: string;
  cases?: readonly Case[];
  defaultBudget?: number;
}

export async function runSuite(deps: RunnerDeps, opts: RunOptions): Promise<EvidencePackage> {
  const cases = opts.cases ?? CASES;
  const defaultBudget = opts.defaultBudget ?? 4000;
  const sampleIntervalMs = deps.sampleIntervalMs ?? 1000;
  const startedAt = new Date().toISOString();
  const runs: CaseRun[] = [];
  let first = true;

  for (let rep = 1; rep <= opts.replications; rep += 1) {
    for (const c of cases) {
      const sampler = startSampling(() => deps.readVram(opts.model), sampleIntervalMs);
      let result: GenerateResult;
      try {
        result = await deps.generate(opts.model, c.prompt, c.budget ?? defaultBudget);
      } catch (error) {
        result = { text: '', outcome: 'transport_error', ms: 0 };
        void error;
      }
      const vram = profile(sampler.stop());

      const item: ItemResult = result.outcome === 'completed'
        ? (result.text.trim()
            ? score('completed', result.ms, c.check(result.text) ? 'pass' : 'fail')
            // A complete response containing nothing is an outcome, not a wrong answer.
            : noResult('empty', result.ms, 'completed with no content'))
        : noResult(result.outcome, result.ms);

      runs.push({
        ...item, caseId: c.id, dimension: c.dimension, replication: rep,
        transcript: result.text, cold: first, vram,
      });
      first = false;
    }
  }

  const dimensions: DimensionScore[] = (Object.keys(DIMENSION_MINIMUMS) as Dimension[]).map((d) => {
    const t = tally(runs.filter((r) => r.dimension === d));
    return { dimension: d, rate: t.rate, scored: t.scored, notScored: t.notScored };
  });

  const overallTally = tally(runs);
  const cov = coverage(overallTally);

  // 🚨 Latency from SCORED runs only. A timeout's duration is real and belongs
  // in the cost story, not in a distribution meant to describe answering.
  const answered = runs.filter(isScored);
  const coldMs = answered.filter((r) => r.cold).map((r) => r.ms);
  const warmMs = answered.filter((r) => !r.cold).map((r) => r.ms);

  return {
    capability: 'reasoning.deep',
    suiteRevision: SUITE_REVISION,
    thresholdRevision: THRESHOLD_REVISION,
    policyVersion: POLICY_VERSION,
    candidate: opts.candidate,
    harness: { replications: opts.replications, defaultBudget, sampleIntervalMs },
    contention: opts.contention,
    startedAt,
    finishedAt: new Date().toISOString(),
    runs,
    dimensions,
    latency: { coldMs, warmMedianMs: median(warmMs), warmP95Ms: p95(warmMs) },
    vram: {
      peakModelBytes: Math.max(0, ...runs.map((r) => r.vram.peakModelBytes)),
      peakTotalBytes: Math.max(0, ...runs.map((r) => r.vram.peakTotalBytes)),
      transitions: runs.reduce((a, r) => a + r.vram.transitions, 0),
      residencyRatio: runs.length === 0 ? 0
        : runs.reduce((a, r) => a + r.vram.residencyRatio, 0) / runs.length,
      sharedDevice: runs.some((r) => r.vram.sharedDevice),
    },
    coverage: cov,
    verdict: verdictFor(dimensions, cov, MINIMUM_COVERAGE),
  };
}
