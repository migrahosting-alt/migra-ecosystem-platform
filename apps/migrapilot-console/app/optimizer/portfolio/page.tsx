'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScopeDimension =
  | 'rolloutStage'
  | 'region'
  | 'deviceClass'
  | 'accountTier'
  | 'riskBucket';

interface ScopePredicate {
  dimension: ScopeDimension;
  values: string[];
}

interface PolicyScope {
  scopeId: string;
  label: string;
  predicates: ScopePredicate[];
  priority: number;
}

type EffectivenessRating = 'effective' | 'neutral' | 'underperforming' | 'insufficientData';

interface PolicyEffectiveness {
  policyVersion: string;
  rating: EffectivenessRating;
  evaluationCount: number;
  escalationCount: number;
  proceedRate: number;
  averageCrashRate: number;
}

interface PortfolioEntry {
  scope: PolicyScope;
  policyVersion: string;
  isActive: boolean;
  effectiveness: PolicyEffectiveness | null;
}

type ConflictKind = 'samePriorityOverlap' | 'specificityOverridden' | 'duplicateDimensionValues';
type ConflictSeverity = 'info' | 'warning' | 'error';

interface PolicyConflict {
  kind: ConflictKind;
  severity: ConflictSeverity;
  scopeA: string;
  scopeB: string;
  summary: string;
}

interface CohortComparison {
  cohortA: string;
  cohortB: string;
  proceedRateDelta: number;
  crashRateDelta: number;
  escalationDelta: number;
  betterPerformer: string;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleEntries: PortfolioEntry[] = [
  {
    scope: {
      scopeId: 'global-default',
      label: 'Global Default',
      predicates: [],
      priority: 0,
    },
    policyVersion: 'v2-balanced',
    isActive: true,
    effectiveness: {
      policyVersion: 'v2-balanced',
      rating: 'neutral',
      evaluationCount: 412,
      escalationCount: 8,
      proceedRate: 0.78,
      averageCrashRate: 0.011,
    },
  },
  {
    scope: {
      scopeId: 'canary-us-east',
      label: 'Canary — US East',
      predicates: [
        { dimension: 'rolloutStage', values: ['canary'] },
        { dimension: 'region', values: ['us-east'] },
      ],
      priority: 10,
    },
    policyVersion: 'v3-safer',
    isActive: true,
    effectiveness: {
      policyVersion: 'v3-safer',
      rating: 'effective',
      evaluationCount: 64,
      escalationCount: 1,
      proceedRate: 0.89,
      averageCrashRate: 0.006,
    },
  },
  {
    scope: {
      scopeId: 'enterprise-tier',
      label: 'Enterprise Accounts',
      predicates: [{ dimension: 'accountTier', values: ['enterprise'] }],
      priority: 20,
    },
    policyVersion: 'v2-enterprise-strict',
    isActive: true,
    effectiveness: {
      policyVersion: 'v2-enterprise-strict',
      rating: 'effective',
      evaluationCount: 156,
      escalationCount: 0,
      proceedRate: 0.94,
      averageCrashRate: 0.003,
    },
  },
  {
    scope: {
      scopeId: 'low-end-devices',
      label: 'Low-End Devices',
      predicates: [{ dimension: 'deviceClass', values: ['low-end'] }],
      priority: 5,
    },
    policyVersion: 'v2-conservative',
    isActive: true,
    effectiveness: {
      policyVersion: 'v2-conservative',
      rating: 'neutral',
      evaluationCount: 98,
      escalationCount: 4,
      proceedRate: 0.71,
      averageCrashRate: 0.018,
    },
  },
  {
    scope: {
      scopeId: 'beta-high-risk',
      label: 'Beta — High Risk Bucket',
      predicates: [
        { dimension: 'rolloutStage', values: ['beta'] },
        { dimension: 'riskBucket', values: ['high'] },
      ],
      priority: 15,
    },
    policyVersion: 'v3-experimental',
    isActive: true,
    effectiveness: {
      policyVersion: 'v3-experimental',
      rating: 'underperforming',
      evaluationCount: 32,
      escalationCount: 5,
      proceedRate: 0.62,
      averageCrashRate: 0.024,
    },
  },
];

const sampleConflicts: PolicyConflict[] = [
  {
    kind: 'duplicateDimensionValues',
    severity: 'info',
    scopeA: 'canary-us-east',
    scopeB: 'beta-high-risk',
    summary:
      'Scopes "canary-us-east" and "beta-high-risk" share overlapping rollout stage dimension; resolved by priority.',
  },
];

const sampleComparison: CohortComparison = {
  cohortA: 'canary-us-east',
  cohortB: 'global-default',
  proceedRateDelta: 0.11,
  crashRateDelta: -0.005,
  escalationDelta: -7,
  betterPerformer: 'canary-us-east',
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

const conflictSeverityTone: Record<ConflictSeverity, string> = {
  info: 'bg-slate-100 text-slate-600',
  warning: 'bg-amber-50 text-amber-700',
  error: 'bg-rose-50 text-rose-700',
};

const dimensionLabel: Record<ScopeDimension, string> = {
  rolloutStage: 'Rollout Stage',
  region: 'Region',
  deviceClass: 'Device Class',
  accountTier: 'Account Tier',
  riskBucket: 'Risk Bucket',
};

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number, inverse = false): string {
  const arrow = inverse ? (v > 0 ? '▲' : v < 0 ? '▼' : '—') : v > 0 ? '▲' : v < 0 ? '▼' : '—';
  const color = inverse
    ? v > 0
      ? 'text-rose-600'
      : 'text-emerald-600'
    : v > 0
      ? 'text-emerald-600'
      : 'text-rose-600';
  return `${arrow} ${Math.abs(v * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Scope tag pills
// ---------------------------------------------------------------------------

function ScopeTags({ predicates }: { predicates: ScopePredicate[] }) {
  if (predicates.length === 0) {
    return <Badge className="bg-slate-100 text-slate-500">Global</Badge>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {predicates.map((p, i) => (
        <Badge key={i} variant="outline" className="text-xs">
          {dimensionLabel[p.dimension]}:{' '}
          {p.values.length === 0 ? '*' : p.values.join(', ')}
        </Badge>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PortfolioDashboard() {
  const [portfolioData, setPortfolioData] = useState(sampleEntries);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${process.env.NEXT_PUBLIC_PILOT_API_BASE ?? 'http://127.0.0.1:3377'}/api/optimizer/portfolio`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (json.ok && json.data?.length > 0) setIsLive(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const entries = portfolioData;
  const conflicts = sampleConflicts;
  const comparison = sampleComparison;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Policy Portfolio
          </h1>
          <p className="text-sm text-slate-500">
            Multi-policy cohort targeting &amp; performance comparison
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-blue-50 text-blue-700">
            {entries.filter((e) => e.isActive).length} Active Policies
          </Badge>
          <Badge className="bg-slate-100 text-slate-600">
            {entries.length} Scopes
          </Badge>
        </div>
      </div>

      {/* ── Portfolio Grid ──────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <Card
            key={entry.scope.scopeId}
            className={
              entry.effectiveness?.rating === 'underperforming'
                ? 'border-rose-200'
                : entry.effectiveness?.rating === 'effective'
                  ? 'border-emerald-200'
                  : ''
            }
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {entry.scope.label}
                </CardTitle>
                <Badge className="text-[10px]" variant="outline">
                  P{entry.scope.priority}
                </Badge>
              </div>
              <div className="mt-1">
                <ScopeTags predicates={entry.scope.predicates} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-slate-900">
                  {entry.policyVersion}
                </span>
                {entry.effectiveness && (
                  <Badge className={ratingTone[entry.effectiveness.rating]}>
                    {ratingLabel[entry.effectiveness.rating]}
                  </Badge>
                )}
              </div>

              {entry.effectiveness && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Proceed Rate</span>
                    <div className="font-bold text-slate-900">
                      {fmtPct(entry.effectiveness.proceedRate)}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Crash Rate</span>
                    <div className="font-bold text-slate-900">
                      {fmtPct(entry.effectiveness.averageCrashRate)}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Evaluations</span>
                    <div className="font-bold text-slate-900">
                      {entry.effectiveness.evaluationCount}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Escalations</span>
                    <div className="font-bold text-slate-900">
                      {entry.effectiveness.escalationCount}
                    </div>
                  </div>
                </div>
              )}

              {!entry.effectiveness && (
                <div className="py-2 text-center text-xs text-slate-400">
                  No effectiveness data yet
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Cohort Comparison ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cohort Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-semibold text-slate-900">
                  {comparison.cohortA}
                </span>
                <span className="mx-2 text-slate-400">vs</span>
                <span className="font-semibold text-slate-900">
                  {comparison.cohortB}
                </span>
              </div>
              <Badge
                className={
                  comparison.betterPerformer === comparison.cohortA
                    ? 'bg-emerald-50 text-emerald-700'
                    : comparison.betterPerformer === comparison.cohortB
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-slate-100 text-slate-500'
                }
              >
                {comparison.betterPerformer === 'tied'
                  ? 'Tied'
                  : `${comparison.betterPerformer} wins`}
              </Badge>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Proceed Rate Δ
                </div>
                <div
                  className={`mt-1 text-lg font-bold ${
                    comparison.proceedRateDelta > 0
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }`}
                >
                  {comparison.proceedRateDelta > 0 ? '▲' : '▼'}{' '}
                  {fmtPct(Math.abs(comparison.proceedRateDelta))}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Crash Rate Δ
                </div>
                <div
                  className={`mt-1 text-lg font-bold ${
                    comparison.crashRateDelta < 0
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }`}
                >
                  {comparison.crashRateDelta < 0 ? '▼' : '▲'}{' '}
                  {fmtPct(Math.abs(comparison.crashRateDelta))}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Escalation Δ
                </div>
                <div
                  className={`mt-1 text-lg font-bold ${
                    comparison.escalationDelta < 0
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }`}
                >
                  {comparison.escalationDelta < 0 ? '▼' : '▲'}{' '}
                  {Math.abs(comparison.escalationDelta)}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Scope Conflicts ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Scope Conflicts</CardTitle>
            {conflicts.length === 0 ? (
              <Badge className="bg-emerald-50 text-emerald-700">
                No Conflicts
              </Badge>
            ) : (
              <Badge className="bg-amber-50 text-amber-700">
                {conflicts.length} Conflict{conflicts.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {conflicts.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">
              All scopes are cleanly separated.
            </div>
          ) : (
            <div className="space-y-3">
              {conflicts.map((c, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <Badge className={conflictSeverityTone[c.severity]}>
                    {c.severity}
                  </Badge>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {c.scopeA}{' '}
                      <span className="text-slate-400">↔</span>{' '}
                      {c.scopeB}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {c.summary}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
