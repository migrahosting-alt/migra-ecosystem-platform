'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LearningRecord {
  recordId: string;
  policyVersion: string;
  cohortKey: string;
  mutations: string[];
  goal: string;
  outcome: string;
  crashRate: number;
  proceedRate: number;
  escalations: number;
  timestamp: string;
}

interface Pattern {
  patternId: string;
  cohortKey: string;
  mutations: string[];
  outcome: string;
  occurrences: number;
  confidence: number;
}

interface KnowledgeGraphSummary {
  nodeCount: number;
  edgeCount: number;
  strongestEdges: { from: string; to: string; relation: string; weight: number }[];
}

interface RecommendationExplanation {
  recommendationId: string;
  supportingRecordCount: number;
  matchedPatternCount: number;
  confidence: number;
  narrative: string;
}

interface LearningDashboardData {
  records: LearningRecord[];
  patterns: Pattern[];
  graphSummary: KnowledgeGraphSummary;
  explanations: RecommendationExplanation[];
}

// ---------------------------------------------------------------------------
// Fallback data
// ---------------------------------------------------------------------------

const fallbackData: LearningDashboardData = {
  records: [
    {
      recordId: 'lr-001',
      policyVersion: 'v3',
      cohortKey: 'android-free',
      mutations: ['tightenCrashThreshold', 'raiseSampleFloor'],
      goal: 'safer',
      outcome: 'improved',
      crashRate: 0.008,
      proceedRate: 0.82,
      escalations: 1,
      timestamp: '2026-04-08T14:30:00Z',
    },
    {
      recordId: 'lr-002',
      policyVersion: 'v2',
      cohortKey: 'android-free',
      mutations: ['relaxCrashThreshold'],
      goal: 'faster',
      outcome: 'degraded',
      crashRate: 0.035,
      proceedRate: 0.91,
      escalations: 4,
      timestamp: '2026-04-07T11:00:00Z',
    },
    {
      recordId: 'lr-003',
      policyVersion: 'v4',
      cohortKey: 'ios-premium',
      mutations: ['tightenCrashThreshold', 'increaseSoakTime'],
      goal: 'safer',
      outcome: 'improved',
      crashRate: 0.005,
      proceedRate: 0.78,
      escalations: 0,
      timestamp: '2026-04-09T09:15:00Z',
    },
  ],
  patterns: [
    {
      patternId: 'android-free::raiseSampleFloor+tightenCrashThreshold',
      cohortKey: 'android-free',
      mutations: ['raiseSampleFloor', 'tightenCrashThreshold'],
      outcome: 'improved',
      occurrences: 5,
      confidence: 0.71,
    },
    {
      patternId: 'android-free::relaxCrashThreshold',
      cohortKey: 'android-free',
      mutations: ['relaxCrashThreshold'],
      outcome: 'degraded',
      occurrences: 3,
      confidence: 0.43,
    },
    {
      patternId: 'ios-premium::increaseSoakTime+tightenCrashThreshold',
      cohortKey: 'ios-premium',
      mutations: ['increaseSoakTime', 'tightenCrashThreshold'],
      outcome: 'improved',
      occurrences: 4,
      confidence: 0.67,
    },
  ],
  graphSummary: {
    nodeCount: 12,
    edgeCount: 18,
    strongestEdges: [
      { from: 'android-free', to: 'tightenCrashThreshold', relation: 'leads_to', weight: 1.0 },
      { from: 'tightenCrashThreshold', to: 'improved', relation: 'leads_to', weight: 0.85 },
      { from: 'relaxCrashThreshold', to: 'degraded', relation: 'leads_to', weight: 0.72 },
    ],
  },
  explanations: [
    {
      recommendationId: 'rec-101',
      supportingRecordCount: 8,
      matchedPatternCount: 2,
      confidence: 0.74,
      narrative:
        'This recommendation is supported by 8 prior similar mutations in cohort "android-free", 6 of which improved outcomes. A recurring pattern with 5 occurrences and 71% confidence reinforces this direction.',
    },
  ],
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_PILOT_API_BASE ?? 'http://127.0.0.1:3377';

function useLearningData(): {
  data: LearningDashboardData;
  isLive: boolean;
  error: string | null;
} {
  const [data, setData] = useState<LearningDashboardData>(fallbackData);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/optimizer/learning`);
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json.data ?? json);
        setIsLive(true);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsLive(false);
      }
    }

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { data, isLive, error };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const outcomeTone: Record<string, string> = {
  improved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  degraded: 'border-rose-200 bg-rose-50 text-rose-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
};

function confidenceBand(c: number): string {
  if (c >= 0.75) return 'high';
  if (c >= 0.45) return 'medium';
  return 'low';
}

const bandTone: Record<string, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-rose-200 bg-rose-50 text-rose-700',
};

// ---------------------------------------------------------------------------
// Pattern card
// ---------------------------------------------------------------------------

function PatternCard({ pattern }: { pattern: Pattern }) {
  const tone = outcomeTone[pattern.outcome] ?? outcomeTone.neutral;
  const band = confidenceBand(pattern.confidence);
  return (
    <Card className="rounded-2xl border-0 shadow-sm">
      <CardContent className="p-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">{pattern.cohortKey}</span>
          <Badge className={tone}>{pattern.outcome}</Badge>
        </div>
        <div className="flex flex-wrap gap-1">
          {pattern.mutations.map((m) => (
            <Badge key={m} variant="outline" className="text-xs">
              {m}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{pattern.occurrences} occurrences</span>
          <Badge className={bandTone[band]}>
            {(pattern.confidence * 100).toFixed(0)}% confidence
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Knowledge graph summary card
// ---------------------------------------------------------------------------

function GraphSummaryCard({ summary }: { summary: KnowledgeGraphSummary }) {
  return (
    <Card className="rounded-2xl border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Knowledge Graph</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-6 text-sm text-slate-600">
          <span>
            <span className="font-semibold text-slate-900">{summary.nodeCount}</span> nodes
          </span>
          <span>
            <span className="font-semibold text-slate-900">{summary.edgeCount}</span> edges
          </span>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Strongest edges
          </div>
          {summary.strongestEdges.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
              <Badge variant="outline" className="text-xs">{e.from}</Badge>
              <span className="text-slate-400">&rarr;</span>
              <Badge variant="outline" className="text-xs">{e.to}</Badge>
              <span className="ml-auto text-slate-400">w={e.weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Explanation panel
// ---------------------------------------------------------------------------

function ExplanationPanel({ explanations }: { explanations: RecommendationExplanation[] }) {
  const [selected, setSelected] = useState(0);
  const exp = explanations[selected];
  if (!exp) return null;
  const band = confidenceBand(exp.confidence);

  return (
    <Card className="rounded-2xl border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recommendation Explanations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {explanations.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {explanations.map((e, i) => (
              <button
                key={e.recommendationId}
                onClick={() => setSelected(i)}
                className={`text-xs px-3 py-1 rounded-full transition ${
                  i === selected
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {e.recommendationId}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span>{exp.supportingRecordCount} supporting records</span>
          <span>{exp.matchedPatternCount} matched patterns</span>
          <Badge className={bandTone[band]}>
            {(exp.confidence * 100).toFixed(0)}% confidence
          </Badge>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">{exp.narrative}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function LearningPage() {
  const { data, isLive, error } = useLearningData();

  const wins = useMemo(
    () =>
      [...data.patterns]
        .filter((p) => p.outcome === 'improved')
        .sort((a, b) => b.confidence - a.confidence),
    [data.patterns],
  );

  const failures = useMemo(
    () =>
      [...data.patterns]
        .filter((p) => p.outcome === 'degraded')
        .sort((a, b) => b.confidence - a.confidence),
    [data.patterns],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Learning Memory
          </h1>
          <p className="text-sm text-slate-500">
            Patterns and evidence from past policy outcomes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLive ? (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Live</Badge>
          ) : (
            <Badge className="border-slate-200 bg-slate-50 text-slate-600">Sample data</Badge>
          )}
          {error && (
            <Badge className="border-rose-200 bg-rose-50 text-rose-700">
              API: {error}
            </Badge>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="text-sm text-slate-500">Records</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">
              {data.records.length}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="text-sm text-slate-500">Patterns</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">
              {data.patterns.length}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="text-sm text-slate-500">Top Wins</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-600">
              {wins.length}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="text-sm text-slate-500">Top Failures</div>
            <div className="mt-2 text-2xl font-semibold text-rose-600">
              {failures.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pattern cards */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">All Patterns</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.patterns.map((p) => (
            <PatternCard key={p.patternId} pattern={p} />
          ))}
          {data.patterns.length === 0 && (
            <p className="text-sm text-slate-400 col-span-full">
              No patterns detected yet. More policy outcomes are needed.
            </p>
          )}
        </div>
      </section>

      {/* Top wins / failures side-by-side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-emerald-700">Top Repeated Wins</h2>
          {wins.length === 0 && (
            <p className="text-sm text-slate-400">No winning patterns yet.</p>
          )}
          {wins.map((p) => (
            <PatternCard key={p.patternId} pattern={p} />
          ))}
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-rose-700">Top Repeated Failures</h2>
          {failures.length === 0 && (
            <p className="text-sm text-slate-400">No failure patterns yet.</p>
          )}
          {failures.map((p) => (
            <PatternCard key={p.patternId} pattern={p} />
          ))}
        </section>
      </div>

      {/* Knowledge graph summary */}
      <GraphSummaryCard summary={data.graphSummary} />

      {/* Explanation browser */}
      <ExplanationPanel explanations={data.explanations} />
    </div>
  );
}
