'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ForecastPoint {
  timestamp: string;
  metric: string;
  observed: number;
  predicted: number;
  lowerBound: number;
  upperBound: number;
  isProjection: boolean;
}

interface RiskTrajectory {
  metric: string;
  points: ForecastPoint[];
  slope: number;
  volatility: number;
  movingAverage: number;
}

interface EarlyWarningSignal {
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  metric: string;
  message: string;
  currentValue: number;
  thresholdValue: number;
  estimatedMinutesToBreach?: number;
  confidence: number;
}

interface PreemptiveRecommendation {
  action: string;
  reason: string;
  urgency: 'info' | 'warning' | 'critical';
  metric: string;
  suggestedRolloutPct?: number;
  confidence: number;
}

interface ForecastSummary {
  policyVersion: string;
  trajectoryCount: number;
  warningCount: number;
  criticalCount: number;
  topRecommendation: string;
}

interface ForecastDashboardData {
  summary: ForecastSummary;
  trajectories: RiskTrajectory[];
  warnings: EarlyWarningSignal[];
  recommendations: PreemptiveRecommendation[];
}

// ---------------------------------------------------------------------------
// Fallback data
// ---------------------------------------------------------------------------

const FALLBACK_DATA: ForecastDashboardData = {
  summary: {
    policyVersion: 'pol-v12',
    trajectoryCount: 5,
    warningCount: 2,
    criticalCount: 1,
    topRecommendation: 'crashRate breached threshold — immediate rollback recommended.',
  },
  trajectories: [
    {
      metric: 'crashRate',
      slope: 0.0004,
      volatility: 0.003,
      movingAverage: 0.018,
      points: [
        { timestamp: '2026-01-12T10:00:00Z', metric: 'crashRate', observed: 0.015, predicted: 0.016, lowerBound: 0.010, upperBound: 0.022, isProjection: false },
        { timestamp: '2026-01-12T10:15:00Z', metric: 'crashRate', observed: 0.017, predicted: 0.017, lowerBound: 0.011, upperBound: 0.023, isProjection: false },
        { timestamp: '2026-01-12T10:30:00Z', metric: 'crashRate', observed: 0.021, predicted: 0.018, lowerBound: 0.012, upperBound: 0.024, isProjection: false },
        { timestamp: '2026-01-12T10:45:00Z', metric: 'crashRate', observed: 0, predicted: 0.019, lowerBound: 0.012, upperBound: 0.026, isProjection: true },
        { timestamp: '2026-01-12T11:00:00Z', metric: 'crashRate', observed: 0, predicted: 0.020, lowerBound: 0.012, upperBound: 0.028, isProjection: true },
      ],
    },
    {
      metric: 'escalationRate',
      slope: 0.0001,
      volatility: 0.001,
      movingAverage: 0.005,
      points: [
        { timestamp: '2026-01-12T10:00:00Z', metric: 'escalationRate', observed: 0.004, predicted: 0.005, lowerBound: 0.003, upperBound: 0.007, isProjection: false },
        { timestamp: '2026-01-12T10:15:00Z', metric: 'escalationRate', observed: 0.006, predicted: 0.005, lowerBound: 0.003, upperBound: 0.007, isProjection: false },
      ],
    },
  ],
  warnings: [
    {
      kind: 'thresholdBreached',
      severity: 'critical',
      metric: 'crashRate',
      message: 'crashRate has breached threshold: 0.0210 >= 0.0200',
      currentValue: 0.021,
      thresholdValue: 0.02,
      confidence: 0.95,
    },
    {
      kind: 'trendAccelerating',
      severity: 'warning',
      metric: 'crashRate',
      message: 'crashRate trend projects breach by 2026-01-12T11:00:00Z',
      currentValue: 0.018,
      thresholdValue: 0.02,
      estimatedMinutesToBreach: 30,
      confidence: 0.55,
    },
  ],
  recommendations: [
    {
      action: 'triggerRollback',
      reason: 'crashRate breached threshold — immediate rollback recommended.',
      urgency: 'critical',
      metric: 'crashRate',
      confidence: 0.95,
    },
    {
      action: 'reduceRollout',
      reason: 'crashRate trend accelerating toward threshold. Reduce rollout preemptively.',
      urgency: 'warning',
      metric: 'crashRate',
      suggestedRolloutPct: 25,
      confidence: 0.55,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const severityColor: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  warning: 'bg-yellow-500 text-black',
  info: 'bg-blue-500 text-white',
};

const actionLabel: Record<string, string> = {
  reduceRollout: 'Reduce Rollout',
  pauseRollout: 'Pause Rollout',
  triggerRollback: 'Trigger Rollback',
  activateKillSwitch: 'Kill Switch',
  increaseMonitoring: 'Increase Monitoring',
  notifyOperator: 'Notify Operator',
  noAction: 'No Action',
};

function formatPct(v: number): string {
  return (v * 100).toFixed(2) + '%';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiRow({ summary }: { summary: ForecastSummary }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Policy</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono">{summary.policyVersion}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Trajectories</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono">{summary.trajectoryCount}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Warnings</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono text-yellow-600">{summary.warningCount}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Critical</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono text-red-600">{summary.criticalCount}</CardContent>
      </Card>
    </div>
  );
}

function TrajectoryCard({ traj }: { traj: RiskTrajectory }) {
  const trend = traj.slope > 0 ? '▲' : traj.slope < 0 ? '▼' : '—';
  const trendColor = traj.slope > 0 ? 'text-red-500' : traj.slope < 0 ? 'text-green-500' : 'text-gray-400';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <span className="font-mono">{traj.metric}</span>
          <span className={trendColor}>{trend}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Moving Avg</span>
          <span className="font-mono">{formatPct(traj.movingAverage)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Slope</span>
          <span className="font-mono">{traj.slope.toFixed(6)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Volatility (σ)</span>
          <span className="font-mono">{formatPct(traj.volatility)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Observed Points</span>
          <span className="font-mono">{traj.points.filter((p) => !p.isProjection).length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Projected Points</span>
          <span className="font-mono">{traj.points.filter((p) => p.isProjection).length}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function WarningsTable({ warnings }: { warnings: EarlyWarningSignal[] }) {
  if (warnings.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No active warnings.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left py-1 pr-2">Severity</th>
            <th className="text-left py-1 pr-2">Kind</th>
            <th className="text-left py-1 pr-2">Metric</th>
            <th className="text-left py-1 pr-2">Message</th>
            <th className="text-right py-1 pr-2">ETA (min)</th>
            <th className="text-right py-1">Conf.</th>
          </tr>
        </thead>
        <tbody>
          {warnings.map((w, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-1 pr-2">
                <Badge className={severityColor[w.severity] ?? 'bg-gray-400'}>{w.severity}</Badge>
              </td>
              <td className="py-1 pr-2 font-mono">{w.kind}</td>
              <td className="py-1 pr-2 font-mono">{w.metric}</td>
              <td className="py-1 pr-2">{w.message}</td>
              <td className="py-1 pr-2 text-right font-mono">
                {w.estimatedMinutesToBreach != null ? w.estimatedMinutesToBreach.toFixed(0) : '—'}
              </td>
              <td className="py-1 text-right font-mono">{(w.confidence * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationsPanel({ recommendations }: { recommendations: PreemptiveRecommendation[] }) {
  return (
    <div className="space-y-3">
      {recommendations.map((r, i) => (
        <Card key={i} className="border-l-4" style={{ borderLeftColor: r.urgency === 'critical' ? '#dc2626' : r.urgency === 'warning' ? '#eab308' : '#3b82f6' }}>
          <CardContent className="py-3 space-y-1">
            <div className="flex items-center gap-2">
              <Badge className={severityColor[r.urgency] ?? 'bg-gray-400'}>{actionLabel[r.action] ?? r.action}</Badge>
              <span className="text-xs text-muted-foreground font-mono">{r.metric}</span>
              {r.suggestedRolloutPct != null && (
                <span className="text-xs text-muted-foreground">→ {r.suggestedRolloutPct}%</span>
              )}
            </div>
            <p className="text-sm">{r.reason}</p>
            <p className="text-xs text-muted-foreground">Confidence: {(r.confidence * 100).toFixed(0)}%</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ForecastPage() {
  const [data, setData] = useState<ForecastDashboardData>(FALLBACK_DATA);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        const res = await fetch('/api/optimizer/forecast');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // keep fallback
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const criticalWarnings = useMemo(
    () => data.warnings.filter((w) => w.severity === 'critical'),
    [data.warnings],
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Anomaly Forecast &amp; Early Warning</h1>
        {loading && <span className="text-xs text-muted-foreground animate-pulse">refreshing…</span>}
      </div>

      {/* Top recommendation banner */}
      {criticalWarnings.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">
            ⚠ {data.summary.topRecommendation}
          </p>
        </div>
      )}

      {/* KPI row */}
      <KpiRow summary={data.summary} />

      {/* Trajectories grid */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Risk Trajectories</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.trajectories.map((traj) => (
            <TrajectoryCard key={traj.metric} traj={traj} />
          ))}
        </div>
      </section>

      {/* Warnings table */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Early Warnings{' '}
          <Badge variant="outline" className="ml-2">
            {data.warnings.length}
          </Badge>
        </h2>
        <Card>
          <CardContent className="py-4">
            <WarningsTable warnings={data.warnings} />
          </CardContent>
        </Card>
      </section>

      {/* Recommendations */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Preemptive Recommendations</h2>
        <RecommendationsPanel recommendations={data.recommendations} />
      </section>
    </div>
  );
}
