'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchOptimizer } from '@/lib/api/optimizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecommendationUrgency = 'none' | 'low' | 'medium' | 'high';

type RecommendedAction =
  | 'noAction'
  | 'generateCandidate'
  | 'reviewCandidate'
  | 'scheduleExperiment';

type OptimizerGoal = 'safer' | 'balanced' | 'faster';

type SafetyVerdict = 'safe' | 'cautious' | 'blocked';

interface SafetyViolation {
  code: string;
  summary: string;
  field: string;
  proposedValue: number;
  boundaryValue: number;
  isBlocking: boolean;
}

interface SafetyGateResult {
  verdict: SafetyVerdict;
  violations: SafetyViolation[];
  blockingCount: number;
}

interface CandidateRank {
  version: string;
  totalScore: number;
  safetyScore: number;
  improvementScore: number;
  evidenceScore: number;
  safetyResult: SafetyGateResult;
  rationale: string;
}

interface PolicyRecommendation {
  urgency: RecommendationUrgency;
  action: RecommendedAction;
  title: string;
  description: string;
  suggestedGoal: OptimizerGoal | null;
  topCandidate: CandidateRank | null;
  rankedCandidates: CandidateRank[];
  generatedAt: string;
}

type ExperimentStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'rejected';

interface PolicyExperiment {
  experimentId: string;
  candidateVersion: string;
  parentVersion: string;
  goal: OptimizerGoal;
  totalScore: number;
  safetyVerdict: SafetyVerdict;
  status: ExperimentStatus;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  durationMinutes: number;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleCandidates: CandidateRank[] = [
  {
    version: 'v3-safer-a',
    totalScore: 82,
    safetyScore: 40,
    improvementScore: 28,
    evidenceScore: 14,
    safetyResult: { verdict: 'safe', violations: [], blockingCount: 0 },
    rationale: 'Tighter crash-rate threshold and longer soak time improve safety with high confidence.',
  },
  {
    version: 'v3-balanced-b',
    totalScore: 68,
    safetyScore: 40,
    improvementScore: 18,
    evidenceScore: 10,
    safetyResult: { verdict: 'safe', violations: [], blockingCount: 0 },
    rationale: 'Moderate improvement across all axes with strong evidence.',
  },
  {
    version: 'v3-faster-c',
    totalScore: 55,
    safetyScore: 20,
    improvementScore: 30,
    evidenceScore: 5,
    safetyResult: {
      verdict: 'cautious',
      violations: [
        {
          code: 'soak_too_low',
          summary: 'Soak time 8 min below recommended minimum 10 min',
          field: 'soakTimeMinutes',
          proposedValue: 8,
          boundaryValue: 10,
          isBlocking: false,
        },
      ],
      blockingCount: 0,
    },
    rationale: 'Aggressive faster profile; soak time close to hard limit.',
  },
];

const sampleRecommendation: PolicyRecommendation = {
  urgency: 'medium',
  action: 'reviewCandidate',
  title: 'Drift detected — safer candidates available',
  description:
    'Drift signals indicate escalation rate is rising. 3 candidates ranked; top candidate v3-safer-a has a safety score of 40/40 and total score 82/100.',
  suggestedGoal: 'safer',
  topCandidate: sampleCandidates[0],
  rankedCandidates: sampleCandidates,
  generatedAt: '2026-04-09T21:00:00Z',
};

const sampleExperiments: PolicyExperiment[] = [
  {
    experimentId: 'exp-1744232400000',
    candidateVersion: 'v3-safer-a',
    parentVersion: 'v2',
    goal: 'safer',
    totalScore: 82,
    safetyVerdict: 'safe',
    status: 'completed',
    scheduledAt: '2026-04-09T18:00:00Z',
    startedAt: '2026-04-09T18:02:00Z',
    completedAt: '2026-04-09T19:02:00Z',
    resultSummary: 'Proceed rate improved to 81%, crash rate down to 0.8%.',
    durationMinutes: 60,
  },
  {
    experimentId: 'exp-1744236000000',
    candidateVersion: 'v3-balanced-b',
    parentVersion: 'v2',
    goal: 'balanced',
    totalScore: 68,
    safetyVerdict: 'safe',
    status: 'pending',
    scheduledAt: '2026-04-09T21:00:00Z',
    startedAt: null,
    completedAt: null,
    resultSummary: null,
    durationMinutes: 60,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const urgencyTone: Record<RecommendationUrgency, string> = {
  none: 'bg-slate-100 text-slate-600',
  low: 'bg-blue-50 text-blue-700',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-rose-50 text-rose-700',
};

const urgencyLabel: Record<RecommendationUrgency, string> = {
  none: 'No Action',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const actionLabel: Record<RecommendedAction, string> = {
  noAction: 'No Action Needed',
  generateCandidate: 'Generate Candidates',
  reviewCandidate: 'Review Candidates',
  scheduleExperiment: 'Schedule Experiment',
};

const goalTone: Record<OptimizerGoal, string> = {
  safer: 'bg-emerald-50 text-emerald-700',
  balanced: 'bg-blue-50 text-blue-700',
  faster: 'bg-violet-50 text-violet-700',
};

const verdictTone: Record<SafetyVerdict, string> = {
  safe: 'bg-emerald-50 text-emerald-700',
  cautious: 'bg-amber-50 text-amber-700',
  blocked: 'bg-rose-50 text-rose-700',
};

const experimentStatusTone: Record<ExperimentStatus, string> = {
  pending: 'bg-blue-50 text-blue-700',
  running: 'bg-amber-50 text-amber-700',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  rejected: 'bg-rose-50 text-rose-700',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Score bar
// ---------------------------------------------------------------------------

function ScoreBar({
  safety,
  improvement,
  evidence,
}: {
  safety: number;
  improvement: number;
  evidence: number;
}) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full">
      <div
        className="bg-emerald-400"
        style={{ width: `${safety}%` }}
        title={`Safety: ${safety}`}
      />
      <div
        className="bg-blue-400"
        style={{ width: `${improvement}%` }}
        title={`Improvement: ${improvement}`}
      />
      <div
        className="bg-violet-400"
        style={{ width: `${evidence}%` }}
        title={`Evidence: ${evidence}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RecommendationsDashboard() {
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOptimizer('/decisions').then(res => {
      if (cancelled) return;
      if (res.ok) setIsLive(true);
    });
    return () => { cancelled = true; };
  }, []);

  const rec = sampleRecommendation;
  const experiments = sampleExperiments;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Recommendations
          </h1>
          <p className="text-sm text-slate-500">
            Autonomous policy tuning &amp; experiment scheduling
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={urgencyTone[rec.urgency]}>
            {urgencyLabel[rec.urgency]} Urgency
          </Badge>
          <span className="text-xs text-slate-400">
            {fmtDate(rec.generatedAt)}
          </span>
        </div>
      </div>

      {/* ── Recommendation Card ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{rec.title}</CardTitle>
            <Badge variant="outline">{actionLabel[rec.action]}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">{rec.description}</p>
          {rec.suggestedGoal && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-slate-700">Suggested Goal:</span>
              <Badge className={goalTone[rec.suggestedGoal]}>
                {rec.suggestedGoal}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Ranked Candidates ────────────────────────────────────── */}
      {rec.rankedCandidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ranked Candidates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Legend */}
              <div className="flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                  Safety (0–40)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                  Improvement (0–40)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-400" />
                  Evidence (0–20)
                </span>
              </div>

              {rec.rankedCandidates.map((c, i) => (
                <div
                  key={c.version}
                  className={`rounded-lg border p-4 ${
                    i === 0 ? 'border-emerald-200 bg-emerald-50/30' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-slate-400">
                        #{i + 1}
                      </span>
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        {c.version}
                      </span>
                      <Badge className={verdictTone[c.safetyResult.verdict]}>
                        {c.safetyResult.verdict}
                      </Badge>
                    </div>
                    <span className="text-2xl font-bold text-slate-900">
                      {c.totalScore}
                      <span className="text-sm font-normal text-slate-400">
                        /100
                      </span>
                    </span>
                  </div>

                  <div className="mt-3">
                    <ScoreBar
                      safety={c.safetyScore}
                      improvement={c.improvementScore}
                      evidence={c.evidenceScore}
                    />
                  </div>

                  <p className="mt-2 text-xs text-slate-500">{c.rationale}</p>

                  {/* Safety violations */}
                  {c.safetyResult.violations.length > 0 && (
                    <div className="mt-2 rounded border border-amber-200 bg-amber-50/40 p-2">
                      <div className="text-xs font-semibold text-amber-700">
                        Violations ({c.safetyResult.violations.length})
                      </div>
                      {c.safetyResult.violations.map((v, vi) => (
                        <div key={vi} className="mt-1 text-xs text-amber-600">
                          <span className="font-mono">{v.field}</span>: {v.summary}
                          {v.isBlocking && (
                            <Badge className="ml-1 bg-rose-50 text-rose-700 text-[10px] px-1 py-0">
                              blocking
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Experiments ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Experiments</CardTitle>
        </CardHeader>
        <CardContent>
          {experiments.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              No experiments scheduled yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">Candidate</th>
                    <th className="py-2 pr-4">Goal</th>
                    <th className="py-2 pr-4">Score</th>
                    <th className="py-2 pr-4">Safety</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Scheduled</th>
                    <th className="py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {experiments.map((e) => (
                    <tr key={e.experimentId} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                        {e.experimentId.slice(-8)}
                      </td>
                      <td className="py-2 pr-4 font-mono font-semibold">
                        {e.candidateVersion}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge className={goalTone[e.goal]}>{e.goal}</Badge>
                      </td>
                      <td className="py-2 pr-4 font-bold">{e.totalScore}</td>
                      <td className="py-2 pr-4">
                        <Badge className={verdictTone[e.safetyVerdict]}>
                          {e.safetyVerdict}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge className={experimentStatusTone[e.status]}>
                          {e.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-500">
                        {fmtDate(e.scheduledAt)}
                      </td>
                      <td className="py-2 text-xs text-slate-500">
                        {e.resultSummary ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
