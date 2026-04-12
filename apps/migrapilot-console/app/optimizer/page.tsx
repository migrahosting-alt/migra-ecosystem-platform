'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PolicyOptimizerSummary {
  currentVersion: string;
  candidateVersion: string;
  goal: string;
  confidence: number;
  mutationCount: number;
  signalCount: number;
  summary: string;
}

interface MutationRow {
  action: string;
  field: string;
  beforeValue: string;
  afterValue: string;
  reason: string;
}

interface SignalRow {
  code: string;
  summary: string;
  magnitude: number;
}

interface CandidateProfile {
  [key: string]: string | number | boolean | null | undefined;
}

interface PolicyOptimizerData {
  summary: PolicyOptimizerSummary;
  mutations: MutationRow[];
  signals: SignalRow[];
  candidateProfile: CandidateProfile;
}

// ---------------------------------------------------------------------------
// Fallback data (used when API is unavailable)
// ---------------------------------------------------------------------------

const fallbackData: PolicyOptimizerData = {
  summary: {
    currentVersion: 'v1',
    candidateVersion: 'v2',
    goal: 'safer',
    confidence: 0.72,
    mutationCount: 4,
    signalCount: 3,
    summary: 'Generated v2 from v1 with 4 mutation(s) for safer optimization.',
  },
  mutations: [
    {
      action: 'tightenCrashThreshold',
      field: 'crashRateRollbackThreshold',
      beforeValue: '0.02',
      afterValue: '0.015',
      reason: 'Elevated risk score warrants tighter crash threshold.',
    },
    {
      action: 'tightenTelemetryCoverage',
      field: 'minTelemetryCoverage',
      beforeValue: '0.80',
      afterValue: '0.85',
      reason: 'Better telemetry coverage reduces blind spots.',
    },
    {
      action: 'raiseSampleFloor',
      field: 'minSampledSessions',
      beforeValue: '50',
      afterValue: '75',
      reason: 'High-risk divergences indicate insufficient sample confidence.',
    },
    {
      action: 'increaseSoakTime',
      field: 'promoteSoakMinutes',
      beforeValue: '60',
      afterValue: '75',
      reason: 'Extended soak time provides more observation window.',
    },
  ],
  signals: [
    { code: 'risk_score', summary: 'Comparison risk score: 52.3', magnitude: 52.3 },
    { code: 'divergence_rate', summary: 'Divergence rate: 18.5%', magnitude: 0.185 },
    { code: 'high_risk_divergences', summary: '2 high-risk divergence(s) detected.', magnitude: 2 },
  ],
  candidateProfile: {
    version: 'v2',
    parentVersion: 'v1',
    minSampledSessions: 75,
    minTelemetryCoverage: 0.85,
    crashRateRollbackThreshold: 0.015,
    crashRateKillSwitchThreshold: 0.05,
    maxP0BeforeRollback: 3,
    maxSnapshotAgeMinutes: 15,
    promoteSoakMinutes: 75,
    maxAutoPromoteRiskClass: 0,
  },
};

// ---------------------------------------------------------------------------
// API fetch hook
// ---------------------------------------------------------------------------

const OPTIMIZER_API_BASE =
  process.env.NEXT_PUBLIC_PILOT_API_BASE ?? 'http://127.0.0.1:3377';

function useOptimizerData(): { data: PolicyOptimizerData; isLive: boolean; error: string | null } {
  const [data, setData] = useState<PolicyOptimizerData>(fallbackData);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOptimizer() {
      try {
        const [summaryRes, mutationsRes, signalsRes] = await Promise.all([
          fetch(`${OPTIMIZER_API_BASE}/api/optimizer/summary`),
          fetch(`${OPTIMIZER_API_BASE}/api/optimizer/mutations`),
          fetch(`${OPTIMIZER_API_BASE}/api/optimizer/signals`),
        ]);

        if (!summaryRes.ok) throw new Error(`Summary: ${summaryRes.status}`);

        const summaryJson = await summaryRes.json();
        const mutationsJson = mutationsRes.ok ? await mutationsRes.json() : { data: [] };
        const signalsJson = signalsRes.ok ? await signalsRes.json() : { data: [] };

        if (cancelled) return;

        const summary = summaryJson.data ?? summaryJson;
        const mutations = mutationsJson.data ?? [];
        const signals = signalsJson.data ?? [];

        setData({
          summary: {
            ...fallbackData.summary,
            ...summary,
            mutationCount: mutations.length || summary.mutationCount || 0,
            signalCount: signals.length || summary.signalCount || 0,
          },
          mutations: mutations.length > 0 ? mutations : fallbackData.mutations,
          signals: signals.length > 0 ? signals : fallbackData.signals,
          candidateProfile: fallbackData.candidateProfile,
        });
        setIsLive(true);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsLive(false);
        // Keep fallback data on error
      }
    }

    fetchOptimizer();
    // Refresh every 30 seconds
    const interval = setInterval(fetchOptimizer, 30_000);
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

function confidenceBand(c: number): string {
  if (c >= 0.8) return 'high';
  if (c >= 0.5) return 'medium';
  return 'low';
}

const confidenceTone: Record<string, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-rose-200 bg-rose-50 text-rose-700',
};

const mutationTone: Record<string, string> = {
  tightenCrashThreshold: 'bg-red-50 text-red-700',
  relaxCrashThreshold: 'bg-emerald-50 text-emerald-700',
  raiseSampleFloor: 'bg-red-50 text-red-700',
  lowerSampleFloor: 'bg-emerald-50 text-emerald-700',
  tightenTelemetryCoverage: 'bg-red-50 text-red-700',
  relaxTelemetryCoverage: 'bg-emerald-50 text-emerald-700',
  reduceSoakTime: 'bg-emerald-50 text-emerald-700',
  increaseSoakTime: 'bg-red-50 text-red-700',
  relaxAutoPromote: 'bg-emerald-50 text-emerald-700',
  tightenAutoPromote: 'bg-red-50 text-red-700',
  raiseP0Threshold: 'bg-emerald-50 text-emerald-700',
  lowerP0Threshold: 'bg-red-50 text-red-700',
};

const goalLabels: Record<string, string> = {
  safer: 'Safer',
  balanced: 'Balanced',
  faster: 'Faster',
};

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint: string;
}) {
  return (
    <Card className="rounded-2xl border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="text-sm text-slate-500">{title}</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          {value}
        </div>
        <div className="mt-1 text-xs text-slate-400">{hint}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bar segment (CSS-based)
// ---------------------------------------------------------------------------

function BarSegment({
  label,
  before,
  after,
  max,
}: {
  label: string;
  before: number;
  after: number;
  max: number;
}) {
  const clamp = (v: number) => Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-xs text-slate-500">
          {before} → {after}
        </span>
      </div>
      <div className="flex gap-1 h-5">
        <div
          className="rounded bg-slate-300"
          style={{ width: `${clamp(before)}%`, minWidth: before > 0 ? '4px' : '0' }}
          title={`Before: ${before}`}
        />
        <div
          className="rounded bg-blue-500"
          style={{ width: `${clamp(after)}%`, minWidth: after > 0 ? '4px' : '0' }}
          title={`After: ${after}`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PolicyOptimizerDashboard() {
  const { data, isLive, error } = useOptimizerData();
  const band = confidenceBand(data.summary.confidence);
  const [activeTab, setActiveTab] = useState<'mutations' | 'signals' | 'profile'>('mutations');

  const mutationChart = useMemo(() => {
    return data.mutations.map((m) => ({
      label: m.field.replace(/([A-Z])/g, ' $1').trim(),
      before: parseFloat(m.beforeValue) || 0,
      after: parseFloat(m.afterValue) || 0,
    }));
  }, [data.mutations]);

  const chartMax = useMemo(() => {
    return mutationChart.reduce(
      (max, d) => Math.max(max, d.before, d.after),
      0,
    );
  }, [mutationChart]);

  const tabItems = [
    { key: 'mutations' as const, label: 'Mutations' },
    { key: 'signals' as const, label: 'Signals' },
    { key: 'profile' as const, label: 'Candidate Profile' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">
              Policy Optimizer
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {data.summary.currentVersion} → {data.summary.candidateVersion}
              <Badge className="ml-2" variant="outline">
                {goalLabels[data.summary.goal] || data.summary.goal}
              </Badge>
              <Badge className={`ml-2 ${isLive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`} variant="outline">
                {isLive ? '● Live' : '○ Offline'}
              </Badge>
              {error && (
                <span className="ml-2 text-xs text-rose-500" title={error}>API error</span>
              )}
            </p>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-6">
          <MetricCard
            title="Current"
            value={data.summary.currentVersion}
            hint="Active policy version"
          />
          <MetricCard
            title="Candidate"
            value={data.summary.candidateVersion}
            hint="Proposed policy version"
          />
          <MetricCard
            title="Goal"
            value={goalLabels[data.summary.goal] || data.summary.goal}
            hint="Current optimizer target"
          />
          <MetricCard
            title="Mutations"
            value={data.summary.mutationCount}
            hint="Policy fields changed"
          />
          <MetricCard
            title="Signals"
            value={data.summary.signalCount}
            hint="Evidence inputs used"
          />
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-500">Optimizer confidence</div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                    {(data.summary.confidence * 100).toFixed(0)}%
                  </div>
                </div>
                <Badge className={`border ${confidenceTone[band]}`}>{band}</Badge>
              </div>
              <div className="mt-3">
                <div className="h-2 w-full rounded-full bg-slate-100">
                  <div
                    className={`h-2 rounded-full ${
                      band === 'high'
                        ? 'bg-emerald-500'
                        : band === 'medium'
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${data.summary.confidence * 100}%` }}
                  />
                </div>
              </div>
              <div className="mt-3 text-sm text-slate-500">{data.summary.summary}</div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="space-y-6">
          <div className="flex gap-1 rounded-2xl bg-white p-1 shadow-sm w-fit">
            {tabItems.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Mutations tab */}
          {activeTab === 'mutations' && (
            <div className="space-y-6">
              <Card className="rounded-2xl border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Parameter shifts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {mutationChart.map((d) => (
                    <BarSegment
                      key={d.label}
                      label={d.label}
                      before={d.before}
                      after={d.after}
                      max={chartMax}
                    />
                  ))}
                </CardContent>
              </Card>

              <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <div className="grid grid-cols-5 gap-4 border-b bg-slate-50 px-5 py-4 text-sm font-medium text-slate-600">
                  <div>Action</div>
                  <div>Field</div>
                  <div>Before</div>
                  <div>After</div>
                  <div>Reason</div>
                </div>
                {data.mutations.map((row, index) => (
                  <div
                    key={`${row.field}-${index}`}
                    className="grid grid-cols-5 gap-4 border-b px-5 py-4 text-sm last:border-b-0"
                  >
                    <div>
                      <Badge className={mutationTone[row.action] || 'bg-slate-100 text-slate-700'}>
                        {row.action}
                      </Badge>
                    </div>
                    <div className="font-medium text-slate-900">{row.field}</div>
                    <div className="text-slate-600">{row.beforeValue}</div>
                    <div className="text-slate-900">{row.afterValue}</div>
                    <div className="text-slate-600">{row.reason}</div>
                  </div>
                ))}
                {data.mutations.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-slate-400">
                    No mutations recommended.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Signals tab */}
          {activeTab === 'signals' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.signals.map((signal) => (
                <Card key={signal.code} className="rounded-2xl border-0 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-500">{signal.code}</div>
                      <Badge variant="outline">{signal.magnitude}</Badge>
                    </div>
                    <div className="mt-3 text-base font-medium text-slate-900">
                      {signal.summary}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {data.signals.length === 0 && (
                <div className="col-span-2 py-8 text-center text-sm text-slate-400">
                  No signals emitted.
                </div>
              )}
            </div>
          )}

          {/* Profile tab */}
          {activeTab === 'profile' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(data.candidateProfile).map(([key, value]) => (
                <Card key={key} className="rounded-2xl border-0 shadow-sm">
                  <CardContent className="p-5">
                    <div className="text-sm text-slate-500">{key}</div>
                    <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                      {String(value)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
