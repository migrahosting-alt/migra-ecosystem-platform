'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CausalEstimate {
  metric: string;
  delta: number;
  relativeDelta: number;
  direction: 'improved' | 'degraded' | 'neutral';
  confidence: number;
}

interface BaselineDelta {
  metric: string;
  baselineValue: number;
  candidateValue: number;
  absoluteDelta: number;
  percentDelta: number;
}

interface ConfidenceFactors {
  snapshotCount: number;
  cohortSimilarity: number;
  decisionStability: number;
  signalQuality: number;
}

interface VerdictDistribution {
  proceed: number;
  hold: number;
  reduceRollout: number;
  rollback: number;
  killSwitch: number;
}

interface CounterfactualDashboard {
  baselineVersion: string;
  candidateVersion: string;
  cohortKey: string;
  snapshotCount: number;
  candidateLikelyBetter: boolean;
  inconclusive: boolean;
  overallImprovementScore: number;
  confidenceScore: number;
  confidenceBand: 'low' | 'medium' | 'high';
  estimates: CausalEstimate[];
  deltas: BaselineDelta[];
  confidenceFactors: ConfidenceFactors;
  confidenceRationale: string;
  baselineVerdicts: VerdictDistribution;
  candidateVerdicts: VerdictDistribution;
}

// ---------------------------------------------------------------------------
// Fallback data
// ---------------------------------------------------------------------------

const fallbackData: CounterfactualDashboard = {
  baselineVersion: 'v2',
  candidateVersion: 'v3',
  cohortKey: 'android-free',
  snapshotCount: 24,
  candidateLikelyBetter: true,
  inconclusive: false,
  overallImprovementScore: 0.18,
  confidenceScore: 0.72,
  confidenceBand: 'medium',
  estimates: [
    { metric: 'crashRate', delta: -0.005, relativeDelta: -0.33, direction: 'improved', confidence: 0.8 },
    { metric: 'proceedRate', delta: 0.04, relativeDelta: 0.05, direction: 'improved', confidence: 0.8 },
    { metric: 'escalations', delta: -2, relativeDelta: -0.25, direction: 'improved', confidence: 0.8 },
    { metric: 'rollbackRate', delta: -0.01, relativeDelta: -0.1, direction: 'neutral', confidence: 0.4 },
    { metric: 'killSwitchRate', delta: 0.0, relativeDelta: 0.0, direction: 'neutral', confidence: 0.4 },
  ],
  deltas: [
    { metric: 'crashRate', baselineValue: 0.015, candidateValue: 0.010, absoluteDelta: -0.005, percentDelta: -0.33 },
    { metric: 'proceedRate', baselineValue: 0.78, candidateValue: 0.82, absoluteDelta: 0.04, percentDelta: 0.051 },
    { metric: 'escalations', baselineValue: 8, candidateValue: 6, absoluteDelta: -2, percentDelta: -0.25 },
    { metric: 'rollbackRate', baselineValue: 0.08, candidateValue: 0.07, absoluteDelta: -0.01, percentDelta: -0.125 },
    { metric: 'killSwitchRate', baselineValue: 0.04, candidateValue: 0.04, absoluteDelta: 0.0, percentDelta: 0.0 },
  ],
  confidenceFactors: {
    snapshotCount: 24,
    cohortSimilarity: 0.5,
    decisionStability: 0.79,
    signalQuality: 0.83,
  },
  confidenceRationale:
    'Confidence is medium. 24 snapshots provide reasonable evidence volume. Decision stability is high (79%).',
  baselineVerdicts: { proceed: 15, hold: 4, reduceRollout: 2, rollback: 2, killSwitch: 1 },
  candidateVerdicts: { proceed: 18, hold: 3, reduceRollout: 1, rollback: 1, killSwitch: 1 },
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_PILOT_API_BASE ?? 'http://127.0.0.1:3377';

function useCounterfactualData(): {
  data: CounterfactualDashboard;
  isLive: boolean;
  error: string | null;
} {
  const [data, setData] = useState<CounterfactualDashboard>(fallbackData);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/optimizer/counterfactuals`);
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

const directionTone: Record<string, string> = {
  improved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  degraded: 'border-rose-200 bg-rose-50 text-rose-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
};

const bandTone: Record<string, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-rose-200 bg-rose-50 text-rose-700',
};

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(4)}`;
}

function fmtPctDelta(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(1)}%`;
}

const metricLabels: Record<string, string> = {
  crashRate: 'Crash Rate',
  proceedRate: 'Proceed Rate',
  escalations: 'Escalations',
  rollbackRate: 'Rollback Rate',
  killSwitchRate: 'Kill-Switch Rate',
};

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card className="rounded-2xl border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="text-sm text-slate-500">{title}</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Delta row
// ---------------------------------------------------------------------------

function DeltaRow({ d }: { d: BaselineDelta }) {
  const improved =
    d.metric === 'proceedRate'
      ? d.absoluteDelta > 0
      : d.absoluteDelta < 0;
  const tone = Math.abs(d.absoluteDelta) < 1e-6
    ? 'text-slate-500'
    : improved
    ? 'text-emerald-600'
    : 'text-rose-600';

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2 text-sm text-slate-700">{metricLabels[d.metric] ?? d.metric}</td>
      <td className="py-2 text-sm text-right tabular-nums">{d.baselineValue.toFixed(4)}</td>
      <td className="py-2 text-sm text-right tabular-nums">{d.candidateValue.toFixed(4)}</td>
      <td className={`py-2 text-sm text-right tabular-nums font-medium ${tone}`}>
        {fmtDelta(d.absoluteDelta)}
      </td>
      <td className={`py-2 text-sm text-right tabular-nums ${tone}`}>
        {fmtPctDelta(d.percentDelta)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Verdict bar
// ---------------------------------------------------------------------------

function VerdictBar({
  label,
  verdicts,
  total,
}: {
  label: string;
  verdicts: VerdictDistribution;
  total: number;
}) {
  const segments = [
    { key: 'proceed', count: verdicts.proceed, color: 'bg-emerald-400' },
    { key: 'hold', count: verdicts.hold, color: 'bg-amber-400' },
    { key: 'reduceRollout', count: verdicts.reduceRollout, color: 'bg-orange-400' },
    { key: 'rollback', count: verdicts.rollback, color: 'bg-rose-400' },
    { key: 'killSwitch', count: verdicts.killSwitch, color: 'bg-red-600' },
  ];

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
        {segments.map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={s.key}
              className={`${s.color} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${s.key}: ${s.count}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CounterfactualsPage() {
  const { data, isLive, error } = useCounterfactualData();

  const verdictLabel = data.candidateLikelyBetter
    ? 'Likely Safer'
    : data.inconclusive
    ? 'Inconclusive'
    : 'Likely Worse';
  const verdictTone = data.candidateLikelyBetter
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : data.inconclusive
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-rose-200 bg-rose-50 text-rose-700';

  const bTotal = Object.values(data.baselineVerdicts).reduce((a, b) => a + b, 0);
  const cTotal = Object.values(data.candidateVerdicts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Counterfactual Replay
          </h1>
          <p className="text-sm text-slate-500">
            {data.baselineVersion} vs {data.candidateVersion} &middot; {data.cohortKey}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={bandTone[data.confidenceBand]}>
            {(data.confidenceScore * 100).toFixed(0)}% confidence
          </Badge>
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
      <div className="grid grid-cols-5 gap-4">
        <MetricCard
          title="Snapshots"
          value={String(data.snapshotCount)}
          hint="Replay evidence"
        />
        <MetricCard
          title="Verdict"
          value={verdictLabel}
        />
        <MetricCard
          title="Improvement"
          value={data.overallImprovementScore.toFixed(2)}
          hint="Weighted score"
        />
        <MetricCard
          title="Confidence"
          value={fmtPct(data.confidenceScore)}
          hint={data.confidenceBand}
        />
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-5 flex items-center justify-center">
            <Badge className={`text-sm px-4 py-1 ${verdictTone}`}>
              {verdictLabel}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Estimated outcome deltas */}
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Estimated Outcome Deltas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {data.estimates.map((e) => (
              <div
                key={e.metric}
                className={`rounded-xl border p-4 ${directionTone[e.direction]}`}
              >
                <div className="text-xs font-medium uppercase tracking-wider opacity-75">
                  {metricLabels[e.metric] ?? e.metric}
                </div>
                <div className="mt-1 text-lg font-semibold">{fmtDelta(e.delta)}</div>
                <div className="text-xs">{fmtPctDelta(e.relativeDelta)}</div>
                <Badge variant="outline" className="mt-2 text-xs capitalize">
                  {e.direction}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Policy A vs B table */}
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {data.baselineVersion} vs {data.candidateVersion}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="py-2 text-left">Metric</th>
                <th className="py-2 text-right">Baseline</th>
                <th className="py-2 text-right">Candidate</th>
                <th className="py-2 text-right">Delta</th>
                <th className="py-2 text-right">% Delta</th>
              </tr>
            </thead>
            <tbody>
              {data.deltas.map((d) => (
                <DeltaRow key={d.metric} d={d} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Confidence panel */}
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Confidence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Snapshots</div>
              <div className="font-semibold">{data.confidenceFactors.snapshotCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Stability</div>
              <div className="font-semibold">{fmtPct(data.confidenceFactors.decisionStability)}</div>
            </div>
            <div>
              <div className="text-slate-500">Signal Quality</div>
              <div className="font-semibold">{fmtPct(data.confidenceFactors.signalQuality)}</div>
            </div>
            <div>
              <div className="text-slate-500">Cohort Similarity</div>
              <div className="font-semibold">{fmtPct(data.confidenceFactors.cohortSimilarity)}</div>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            {data.confidenceRationale}
          </p>
        </CardContent>
      </Card>

      {/* Verdict distribution chart */}
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Verdict Distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <VerdictBar label={`Baseline (${data.baselineVersion})`} verdicts={data.baselineVerdicts} total={bTotal} />
          <VerdictBar label={`Candidate (${data.candidateVersion})`} verdicts={data.candidateVerdicts} total={cTotal} />
          <div className="flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> proceed</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> hold</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-400" /> reduceRollout</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-400" /> rollback</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-600" /> killSwitch</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
