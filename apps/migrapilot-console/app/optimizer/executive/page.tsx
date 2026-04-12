'use client';

import React, { useMemo, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
   Phase 30 — Executive Intelligence Dashboard
   
   Strategic overview for leadership: portfolio health, risk surface,
   ROI estimates, and cohort trend analysis.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Mock data (wired to real providers in production) ────────────────────

const MOCK_COHORTS = [
  { key: 'us-enterprise', health: 0.92, traffic: 0.35, tier: 'healthy' },
  { key: 'eu-smb',        health: 0.71, traffic: 0.25, tier: 'healthy' },
  { key: 'apac-startup',  health: 0.58, traffic: 0.15, tier: 'atRisk' },
  { key: 'latam-free',    health: 0.34, traffic: 0.10, tier: 'critical' },
  { key: 'na-growth',     health: 0.81, traffic: 0.15, tier: 'healthy' },
];

const MOCK_RISKS = [
  { cohort: 'latam-free',   type: 'autonomyFreeze',    severity: 'critical', explanation: 'Autonomy frozen after 3 consecutive guardrail trips' },
  { cohort: 'apac-startup', type: 'repeatedRollback',  severity: 'high',     explanation: '4 rollbacks in 72h window' },
  { cohort: 'eu-smb',       type: 'forecasterWarning', severity: 'medium',   explanation: 'Escalation triggered by drift detector' },
];

const MOCK_ROI = {
  crashReduction: 42.3,
  supportReduction: 28.7,
  rolloutSpeedGain: 61.5,
  confidence: 0.78,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function healthColor(score: number): string {
  if (score >= 0.7) return 'bg-green-500';
  if (score >= 0.4) return 'bg-yellow-500';
  return 'bg-red-500';
}

function severityBadge(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-600 text-white';
    case 'high':     return 'bg-orange-500 text-white';
    case 'medium':   return 'bg-yellow-400 text-black';
    default:         return 'bg-gray-300 text-black';
  }
}

function tierBadge(tier: string): string {
  switch (tier) {
    case 'healthy':  return 'bg-green-100 text-green-800';
    case 'atRisk':   return 'bg-yellow-100 text-yellow-800';
    case 'critical': return 'bg-red-100 text-red-800';
    default:         return 'bg-gray-100 text-gray-800';
  }
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d');

  const globalHealth = useMemo(() => {
    let wSum = 0, wTot = 0;
    for (const c of MOCK_COHORTS) {
      wSum += c.health * c.traffic;
      wTot += c.traffic;
    }
    return wTot > 0 ? wSum / wTot : 0;
  }, []);

  const healthyCt  = MOCK_COHORTS.filter(c => c.tier === 'healthy').length;
  const atRiskCt   = MOCK_COHORTS.filter(c => c.tier === 'atRisk').length;
  const criticalCt = MOCK_COHORTS.filter(c => c.tier === 'critical').length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Executive Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            Strategic overview — Policy v3.2.1
          </p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d'] as const).map(r => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1 text-sm rounded border ${
                timeRange === r
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              }`}
            >
              {r === '7d' ? '7 Days' : '30 Days'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Top Summary Cards ──────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Overall Health"
          value={`${(globalHealth * 100).toFixed(1)}%`}
          accent={healthColor(globalHealth)}
        />
        <SummaryCard label="Healthy" value={String(healthyCt)} accent="bg-green-500" />
        <SummaryCard label="At Risk" value={String(atRiskCt)} accent="bg-yellow-500" />
        <SummaryCard label="Critical" value={String(criticalCt)} accent="bg-red-500" />
      </div>

      {/* ── Portfolio Heatmap ──────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold mb-3">Portfolio Health</h2>
        <div className="space-y-2">
          {MOCK_COHORTS.map(c => (
            <div key={c.key} className="flex items-center gap-3">
              <span className="w-32 text-sm font-medium truncate">{c.key}</span>
              <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                <div
                  className={`h-full ${healthColor(c.health)} transition-all`}
                  style={{ width: `${c.health * 100}%` }}
                />
              </div>
              <span className="w-12 text-sm text-right">
                {(c.health * 100).toFixed(0)}%
              </span>
              <span className={`text-xs px-2 py-0.5 rounded ${tierBadge(c.tier)}`}>
                {c.tier}
              </span>
              <span className="w-14 text-xs text-muted-foreground text-right">
                {(c.traffic * 100).toFixed(0)}% traffic
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Risk Panel ─────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold mb-3">
          Strategic Risks
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({MOCK_RISKS.length} active)
          </span>
        </h2>
        <div className="divide-y">
          {MOCK_RISKS.map((r, i) => (
            <div key={i} className="py-2 flex items-start gap-3">
              <span className={`text-xs px-2 py-0.5 rounded ${severityBadge(r.severity)}`}>
                {r.severity}
              </span>
              <div className="flex-1">
                <span className="text-sm font-medium">{r.cohort}</span>
                <span className="mx-1 text-muted-foreground">·</span>
                <span className="text-sm text-muted-foreground">{r.type}</span>
                <p className="text-sm mt-0.5">{r.explanation}</p>
              </div>
            </div>
          ))}
          {MOCK_RISKS.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No active risks.</p>
          )}
        </div>
      </div>

      {/* ── ROI Panel ──────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold mb-3">
          Optimization ROI
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            (confidence: {(MOCK_ROI.confidence * 100).toFixed(0)}%)
          </span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <RoiCard label="Crash Reduction"       value={`${MOCK_ROI.crashReduction.toFixed(1)}%`} />
          <RoiCard label="Support Reduction"      value={`${MOCK_ROI.supportReduction.toFixed(1)}%`} />
          <RoiCard label="Rollout Speed Gain"     value={`${MOCK_ROI.rolloutSpeedGain.toFixed(1)}%`} />
        </div>
      </div>

      {/* ── Trend View (Placeholder) ──────────────────────────── */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold mb-3">
          Health Trend ({timeRange === '7d' ? '7 Days' : '30 Days'})
        </h2>
        <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
          Chart placeholder — connect to time-series data source
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function SummaryCard({ label, value, accent }: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-2 h-2 rounded-full ${accent}`} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-2xl font-bold">{value}</span>
    </div>
  );
}

function RoiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3 text-center">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className="text-xl font-bold text-green-600">{value}</div>
    </div>
  );
}
