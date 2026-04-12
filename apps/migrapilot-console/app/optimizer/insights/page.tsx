'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchOptimizer } from '@/lib/api/optimizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EffectivenessRating = 'effective' | 'neutral' | 'underperforming' | 'insufficientData';

interface PolicyEffectivenessSummary {
  policyVersion: string;
  rating: EffectivenessRating;
  evaluationCount: number;
  escalationCount: number;
  guardrailTriggerCount: number;
  proceedRate: number;
  averageCrashRate: number;
  activeSinceMinutes: number;
  verdictDistribution: Record<string, number>;
}

type DriftKind =
  | 'crashRateAboveThreshold'
  | 'excessiveGuardrailTriggers'
  | 'stalePolicy'
  | 'escalationRateRising'
  | 'proceedRateDeclining';

type DriftSeverity = 'info' | 'warning' | 'critical';

interface DriftSignal {
  kind: DriftKind;
  severity: DriftSeverity;
  policyVersion: string;
  summary: string;
  observedValue: number;
  expectedValue: number;
  detectedAt: string;
}

interface DriftReport {
  policyVersion: string;
  signals: DriftSignal[];
  evaluatedAt: string;
  hasDrift: boolean;
  hasCritical: boolean;
}

type InsightKind = 'healthy' | 'driftDetected' | 'underperforming' | 'insufficientData' | 'stale';

interface PolicyInsight {
  kind: InsightKind;
  title: string;
  description: string;
  policyVersion: string;
  timestamp: string;
}

interface PolicyOutcomeReport {
  policyVersion: string;
  effectiveness: PolicyEffectivenessSummary;
  drift: DriftReport;
  insights: PolicyInsight[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleReport: PolicyOutcomeReport = {
  policyVersion: 'v2',
  effectiveness: {
    policyVersion: 'v2',
    rating: 'neutral',
    evaluationCount: 48,
    escalationCount: 3,
    guardrailTriggerCount: 7,
    proceedRate: 0.73,
    averageCrashRate: 0.012,
    activeSinceMinutes: 720,
    verdictDistribution: {
      proceed: 35,
      hold: 8,
      reduceRollout: 2,
      rollback: 2,
      killSwitch: 1,
    },
  },
  drift: {
    policyVersion: 'v2',
    signals: [
      {
        kind: 'excessiveGuardrailTriggers',
        severity: 'warning',
        policyVersion: 'v2',
        summary: 'Guardrail trigger rate 14.6% exceeds 15% threshold',
        observedValue: 0.146,
        expectedValue: 0.15,
        detectedAt: '2026-04-09T20:00:00Z',
      },
      {
        kind: 'crashRateAboveThreshold',
        severity: 'critical',
        policyVersion: 'v2',
        summary: 'Average crash rate 1.20% exceeds policy threshold 1.5%',
        observedValue: 0.012,
        expectedValue: 0.015,
        detectedAt: '2026-04-09T20:00:00Z',
      },
    ],
    evaluatedAt: '2026-04-09T20:00:00Z',
    hasDrift: true,
    hasCritical: true,
  },
  insights: [
    {
      kind: 'driftDetected',
      title: 'Critical drift detected',
      description:
        '2 drift signal(s) detected, including critical issues. Immediate review recommended.',
      policyVersion: 'v2',
      timestamp: '2026-04-09T20:00:00Z',
    },
    {
      kind: 'underperforming',
      title: 'Policy underperforming',
      description:
        'Policy v2 is underperforming with a proceed rate of 73.0% and 3 escalation(s). Consider generating a replacement candidate.',
      policyVersion: 'v2',
      timestamp: '2026-04-09T20:00:00Z',
    },
  ],
  generatedAt: '2026-04-09T20:00:00Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ratingTone: Record<EffectivenessRating, string> = {
  effective: 'bg-emerald-50 text-emerald-700',
  neutral: 'bg-amber-50 text-amber-700',
  underperforming: 'bg-rose-50 text-rose-700',
  insufficientData: 'bg-slate-100 text-slate-500',
};

const ratingLabel: Record<EffectivenessRating, string> = {
  effective: 'Effective',
  neutral: 'Neutral',
  underperforming: 'Underperforming',
  insufficientData: 'Insufficient Data',
};

const severityTone: Record<DriftSeverity, string> = {
  info: 'bg-slate-100 text-slate-700',
  warning: 'bg-amber-50 text-amber-700',
  critical: 'bg-rose-50 text-rose-700',
};

const insightTone: Record<InsightKind, string> = {
  healthy: 'border-l-emerald-500',
  driftDetected: 'border-l-amber-500',
  underperforming: 'border-l-rose-500',
  insufficientData: 'border-l-slate-400',
  stale: 'border-l-purple-500',
};

const insightIcon: Record<InsightKind, string> = {
  healthy: '✓',
  driftDetected: '⚠',
  underperforming: '✗',
  insufficientData: '◌',
  stale: '⏱',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verdict distribution bar
// ---------------------------------------------------------------------------

const verdictColor: Record<string, string> = {
  proceed: 'bg-emerald-400',
  hold: 'bg-amber-400',
  reduceRollout: 'bg-orange-400',
  rollback: 'bg-rose-400',
  killSwitch: 'bg-red-600',
};

function VerdictBar({ distribution }: { distribution: Record<string, number> }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div className="flex h-4 w-full overflow-hidden rounded-full">
      {Object.entries(distribution).map(([verdict, count]) => {
        const pct = (count / total) * 100;
        return (
          <div
            key={verdict}
            className={`${verdictColor[verdict] ?? 'bg-slate-300'}`}
            style={{ width: `${pct}%` }}
            title={`${verdict}: ${count} (${pct.toFixed(1)}%)`}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PolicyInsightsDashboard() {
  const [reportData, setReportData] = useState(sampleReport);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOptimizer<{ signals: typeof sampleReport.drift.signals }>('/signals').then(res => {
      if (cancelled) return;
      if (res.ok && res.data) {
        setIsLive(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const report = reportData;
  const eff = report.effectiveness;
  const drift = report.drift;
  const insights = report.insights;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Policy Insights
          </h1>
          <p className="text-sm text-slate-500">
            Observability &amp; drift detection for active policy
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={ratingTone[eff.rating]}>
            {ratingLabel[eff.rating]}
          </Badge>
          <span className="text-sm font-mono text-slate-600">
            {report.policyVersion}
          </span>
          <span className="text-xs text-slate-400">
            Generated {fmtDate(report.generatedAt)}
          </span>
        </div>
      </div>

      {/* ── Insight cards ───────────────────────────────────────── */}
      {insights.length > 0 && (
        <div className="space-y-3">
          {insights.map((insight, idx) => (
            <div
              key={idx}
              className={`rounded-lg border border-l-4 ${insightTone[insight.kind]} bg-white px-5 py-4`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-lg">{insightIcon[insight.kind]}</span>
                <div>
                  <h3 className="font-semibold text-slate-900">{insight.title}</h3>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {insight.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── KPI strip ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Evaluations"
          value={String(eff.evaluationCount)}
          sub={`Active ${fmtMinutes(eff.activeSinceMinutes)}`}
        />
        <StatCard
          label="Proceed Rate"
          value={fmtPct(eff.proceedRate)}
          sub={`${eff.verdictDistribution['proceed'] ?? 0} of ${eff.evaluationCount}`}
        />
        <StatCard
          label="Escalations"
          value={String(eff.escalationCount)}
          sub={`${fmtPct(eff.evaluationCount > 0 ? eff.escalationCount / eff.evaluationCount : 0)} rate`}
        />
        <StatCard
          label="Avg Crash Rate"
          value={fmtPct(eff.averageCrashRate)}
          sub={`${eff.guardrailTriggerCount} guardrail fires`}
        />
      </div>

      {/* ── Verdict distribution ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verdict Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <VerdictBar distribution={eff.verdictDistribution} />
          <div className="mt-3 flex flex-wrap gap-4">
            {Object.entries(eff.verdictDistribution).map(
              ([verdict, count]) => (
                <div key={verdict} className="flex items-center gap-2 text-sm">
                  <span
                    className={`h-3 w-3 rounded-full ${
                      verdictColor[verdict] ?? 'bg-slate-300'
                    }`}
                  />
                  <span className="text-slate-600">
                    {verdict}{' '}
                    <span className="font-medium text-slate-900">{count}</span>
                  </span>
                </div>
              ),
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Drift signals ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Drift Signals
            {drift.signals.length > 0 && (
              <Badge className="ml-2 bg-rose-50 text-rose-700">
                {drift.signals.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {drift.signals.length === 0 ? (
            <p className="text-sm text-slate-400">
              No drift signals detected.
            </p>
          ) : (
            <div className="divide-y">
              {drift.signals.map((signal, idx) => (
                <div key={idx} className="flex items-start gap-4 py-3">
                  <Badge className={severityTone[signal.severity]}>
                    {signal.severity}
                  </Badge>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-800">
                      {signal.kind
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, (s) => s.toUpperCase())
                        .trim()}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {signal.summary}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div>Observed: {signal.observedValue.toFixed(3)}</div>
                    <div>Expected: {signal.expectedValue.toFixed(3)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div className="text-center text-xs text-slate-400">
        Policy Observability &amp; Drift Detection · Phase 19
      </div>
    </div>
  );
}
