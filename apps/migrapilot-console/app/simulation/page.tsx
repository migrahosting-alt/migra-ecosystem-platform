'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types (mirroring the Dart risk_scoring_system + policy_version_runner)
// ---------------------------------------------------------------------------

interface RiskSignal {
  code: string;
  summary: string;
  weight: number;
}

interface SnapshotRow {
  snapshotId: string;
  phase: string;
  riskClass: string;
  actual: string;
  left: string;
  right: string;
  delta: number;
  riskScore: number;
  band: string;
}

interface VerdictBar {
  name: string;
  actual: number;
  simulated: number;
}

interface DivergenceBucket {
  name: string;
  value: number;
}

interface SimulationSummary {
  leftVersion: string;
  rightVersion: string;
  total: number;
  divergences: number;
  divergenceRate: number;
  rightSaferCount: number;
  rightMoreAggressiveCount: number;
  riskScore: number;
  riskBand: string;
  highRiskDivergenceCount: number;
}

interface DashboardData {
  summary: SimulationSummary;
  verdicts: VerdictBar[];
  divergenceBuckets: DivergenceBucket[];
  signals: RiskSignal[];
  rows: SnapshotRow[];
}

// ---------------------------------------------------------------------------
// Sample data — swap with real API data when wired
// ---------------------------------------------------------------------------

const sampleData: DashboardData = {
  summary: {
    leftVersion: 'v1',
    rightVersion: 'v2',
    total: 48,
    divergences: 11,
    divergenceRate: 22.9,
    rightSaferCount: 7,
    rightMoreAggressiveCount: 3,
    riskScore: 58,
    riskBand: 'high',
    highRiskDivergenceCount: 4,
  },
  verdicts: [
    { name: 'Proceed', actual: 24, simulated: 18 },
    { name: 'Hold', actual: 10, simulated: 13 },
    { name: 'Reduce', actual: 6, simulated: 8 },
    { name: 'Rollback', actual: 5, simulated: 6 },
    { name: 'Kill', actual: 3, simulated: 3 },
  ],
  divergenceBuckets: [
    { name: 'proceed→hold', value: 5 },
    { name: 'hold→rollback', value: 2 },
    { name: 'proceed→reduceRollout', value: 3 },
    { name: 'reduceRollout→rollback', value: 1 },
  ],
  signals: [
    {
      code: 'policy_divergence',
      summary: 'Candidate policy changes runtime behavior frequency.',
      weight: 10.3,
    },
    {
      code: 'high_risk_divergence',
      summary: 'Historical proceed decisions now block or roll back.',
      weight: 36,
    },
    {
      code: 'candidate_more_aggressive',
      summary: 'Candidate policy is materially more aggressive than baseline.',
      weight: 12,
    },
  ],
  rows: [
    {
      snapshotId: 'snap-1001',
      phase: '10_to_25',
      riskClass: 'b',
      actual: 'proceed',
      left: 'proceed',
      right: 'hold',
      delta: 1,
      riskScore: 42,
      band: 'medium',
    },
    {
      snapshotId: 'snap-1002',
      phase: '25_to_50',
      riskClass: 'c',
      actual: 'proceed',
      left: 'proceed',
      right: 'rollback',
      delta: 3,
      riskScore: 81,
      band: 'critical',
    },
    {
      snapshotId: 'snap-1003',
      phase: '50_to_100',
      riskClass: 'd',
      actual: 'hold',
      left: 'hold',
      right: 'hold',
      delta: 0,
      riskScore: 74,
      band: 'high',
    },
    {
      snapshotId: 'snap-1004',
      phase: '25_to_50',
      riskClass: 'a',
      actual: 'proceed',
      left: 'proceed',
      right: 'proceed',
      delta: 0,
      riskScore: 9,
      band: 'low',
    },
  ],
};

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const scoreTone: Record<string, string> = {
  low: 'bg-green-100 text-green-800 border-green-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
};

const verdictTone: Record<string, string> = {
  proceed: 'bg-emerald-100 text-emerald-700',
  hold: 'bg-amber-100 text-amber-700',
  reduceRollout: 'bg-orange-100 text-orange-700',
  rollback: 'bg-rose-100 text-rose-700',
  killSwitch: 'bg-red-100 text-red-700',
};

// ---------------------------------------------------------------------------
// Sub-components
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
    <Card className="rounded-2xl shadow-sm border-0">
      <CardContent className="p-5">
        <div className="text-sm text-slate-500">{title}</div>
        <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          {value}
        </div>
        <div className="mt-2 text-sm text-slate-500">{hint}</div>
      </CardContent>
    </Card>
  );
}

function BarSegment({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-28 shrink-0 text-right text-slate-600">{label}</div>
      <div className="flex-1 rounded-full bg-slate-100 h-5 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-8 text-right font-medium text-slate-800">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function SimulationDashboard() {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'signals' | 'details'>(
    'overview',
  );
  const data = sampleData;

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((row) =>
      [row.snapshotId, row.phase, row.riskClass, row.actual, row.left, row.right, row.band]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [query, data.rows]);

  const maxVerdict = Math.max(...data.verdicts.flatMap((v) => [v.actual, v.simulated]));
  const maxBucket = Math.max(...data.divergenceBuckets.map((b) => b.value), 1);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
              Launch Control Simulation
            </div>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
              Policy Version Runner
            </h1>
            <p className="mt-2 max-w-3xl text-base text-slate-600">
              Compare rollout decisions across policy versions, quantify behavioral
              divergence, and score rollout risk before enabling a candidate policy in
              production.
            </p>
          </div>
          <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
            <div className="text-sm text-slate-500">Active comparison</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <span>{data.summary.leftVersion}</span>
              <span className="text-slate-400">↔</span>
              <span>{data.summary.rightVersion}</span>
            </div>
          </div>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            title="Total snapshots"
            value={data.summary.total}
            hint="Historical evaluations replayed"
          />
          <MetricCard
            title="Divergences"
            value={data.summary.divergences}
            hint={`${data.summary.divergenceRate}% of decisions changed`}
          />
          <MetricCard
            title="Candidate safer"
            value={data.summary.rightSaferCount}
            hint={`Cases where ${data.summary.rightVersion} is stricter`}
          />
          <MetricCard
            title="More aggressive"
            value={data.summary.rightMoreAggressiveCount}
            hint={`Cases where ${data.summary.rightVersion} relaxes controls`}
          />
          {/* Risk score card */}
          <Card className="rounded-2xl shadow-sm border-0">
            <CardContent className="p-5">
              <div className="text-sm text-slate-500">Comparison risk</div>
              <div className="mt-2 flex items-center gap-3">
                <div className="text-3xl font-semibold tracking-tight text-slate-900">
                  {data.summary.riskScore}
                </div>
                <Badge
                  className={`border ${scoreTone[data.summary.riskBand] ?? ''}`}
                >
                  {data.summary.riskBand}
                </Badge>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-orange-400 transition-all"
                  style={{ width: `${data.summary.riskScore}%` }}
                />
              </div>
              <div className="mt-2 text-sm text-slate-500">
                {data.summary.highRiskDivergenceCount} high-risk divergences detected
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="space-y-6">
          <div className="flex gap-1 rounded-2xl bg-white p-1 shadow-sm w-fit">
            {(['overview', 'signals', 'details'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {/* Verdict distribution */}
                <Card className="rounded-2xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Verdict distribution</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {data.verdicts.map((v) => (
                      <div key={v.name} className="space-y-1">
                        <div className="text-xs font-medium text-slate-500">{v.name}</div>
                        <BarSegment
                          label="Actual"
                          value={v.actual}
                          max={maxVerdict}
                          color="bg-slate-400"
                        />
                        <BarSegment
                          label="Simulated"
                          value={v.simulated}
                          max={maxVerdict}
                          color="bg-blue-400"
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Divergence donut */}
                <Card className="rounded-2xl border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Divergence split</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-center py-8">
                      <div className="relative h-48 w-48">
                        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                          <circle
                            cx="18"
                            cy="18"
                            r="15.915"
                            fill="transparent"
                            stroke="#cbd5e1"
                            strokeWidth="3"
                          />
                          <circle
                            cx="18"
                            cy="18"
                            r="15.915"
                            fill="transparent"
                            stroke="#f59e0b"
                            strokeWidth="3"
                            strokeDasharray={`${data.summary.divergenceRate} ${100 - data.summary.divergenceRate}`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-3xl font-semibold text-slate-900">
                            {data.summary.divergenceRate}%
                          </span>
                          <span className="text-xs text-slate-500">diverged</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-center gap-6 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-amber-400" />
                        <span className="text-slate-600">
                          Diverged ({data.summary.divergences})
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-slate-300" />
                        <span className="text-slate-600">
                          Matched ({data.summary.total - data.summary.divergences})
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Divergence buckets */}
              <Card className="rounded-2xl border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Divergence buckets</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.divergenceBuckets.map((b) => (
                    <BarSegment
                      key={b.name}
                      label={b.name}
                      value={b.value}
                      max={maxBucket}
                      color="bg-amber-400"
                    />
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Signals tab */}
          {activeTab === 'signals' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {data.signals.map((signal) => (
                <Card key={signal.code} className="rounded-2xl border-0 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-500">
                        {signal.code}
                      </div>
                      <Badge variant="outline">{signal.weight.toFixed(1)}</Badge>
                    </div>
                    <div className="mt-3 text-base font-medium text-slate-900">
                      {signal.summary}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Details tab */}
          {activeTab === 'details' && (
            <div className="space-y-4">
              <Card className="rounded-2xl border-0 shadow-sm">
                <CardContent className="p-5">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search snapshot, phase, risk class, or verdict…"
                    className="w-full max-w-md rounded-2xl border border-slate-200 px-4 py-2.5 text-sm
                               placeholder:text-slate-400 focus:border-slate-400 focus:outline-none
                               focus:ring-2 focus:ring-slate-200"
                  />
                </CardContent>
              </Card>

              <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <div className="grid grid-cols-8 gap-4 border-b bg-slate-50 px-5 py-4 text-sm font-medium text-slate-600">
                  <div>Snapshot</div>
                  <div>Phase</div>
                  <div>Risk</div>
                  <div>Actual</div>
                  <div>{data.summary.leftVersion}</div>
                  <div>{data.summary.rightVersion}</div>
                  <div>Delta</div>
                  <div>Score</div>
                </div>

                {filteredRows.map((row) => (
                  <div
                    key={row.snapshotId}
                    className="grid grid-cols-8 gap-4 border-b px-5 py-4 text-sm last:border-b-0"
                  >
                    <div className="font-medium text-slate-900">{row.snapshotId}</div>
                    <div className="text-slate-600">{row.phase}</div>
                    <div>
                      <Badge variant="outline">{row.riskClass.toUpperCase()}</Badge>
                    </div>
                    <div>
                      <Badge className={verdictTone[row.actual] ?? ''}>
                        {row.actual}
                      </Badge>
                    </div>
                    <div>
                      <Badge className={verdictTone[row.left] ?? ''}>
                        {row.left}
                      </Badge>
                    </div>
                    <div>
                      <Badge className={verdictTone[row.right] ?? ''}>
                        {row.right}
                      </Badge>
                    </div>
                    <div className="text-slate-700">{row.delta}</div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{row.riskScore}</span>
                      <Badge className={`border ${scoreTone[row.band] ?? ''}`}>
                        {row.band}
                      </Badge>
                    </div>
                  </div>
                ))}

                {filteredRows.length === 0 && (
                  <div className="px-5 py-12 text-center text-sm text-slate-400">
                    No snapshots match your search.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
