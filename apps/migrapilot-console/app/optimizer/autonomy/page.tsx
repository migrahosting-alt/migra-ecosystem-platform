'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutonomyDashboardSummary {
  autonomyEnabled: boolean;
  autonomyFrozen: boolean;
  availableBudget: number;
  actionsExecutedToday: number;
  blockedActionsToday: number;
  cooldownRemainingMinutes: number;
}

interface AutonomousAction {
  actionId: string;
  policyVersion: string;
  cohortKey: string;
  actionType: string;
  rationale: string;
  createdAt: string;
  confidence: number;
  sourceWarningId?: string;
}

interface ExecutionResult {
  applied: boolean;
  summary: string;
  mutations: string[];
  reversible: boolean;
}

interface GuardResult {
  decision: 'continueRunning' | 'revertAction' | 'escalateToOperator';
  summary: string;
  shouldFreezeAutonomy: boolean;
}

interface AutonomyDashboardData {
  summary: AutonomyDashboardSummary;
  recentActions: (AutonomousAction & { result?: ExecutionResult })[];
  blockedReasons: string[];
  guardResults: GuardResult[];
}

// ---------------------------------------------------------------------------
// Fallback data
// ---------------------------------------------------------------------------

const FALLBACK_DATA: AutonomyDashboardData = {
  summary: {
    autonomyEnabled: true,
    autonomyFrozen: false,
    availableBudget: 2,
    actionsExecutedToday: 1,
    blockedActionsToday: 3,
    cooldownRemainingMinutes: 0,
  },
  recentActions: [
    {
      actionId: 'auto_web-users_1736683200000',
      policyVersion: 'pol-v12',
      cohortKey: 'web-users',
      actionType: 'reduceRollout',
      rationale: 'crashRate trend accelerating toward threshold. Reduce rollout preemptively.',
      createdAt: '2026-01-12T10:00:00Z',
      confidence: 0.7,
      sourceWarningId: 'crashRate_reduceRollout',
      result: {
        applied: true,
        summary: 'Reduced rollout from risk class 2 → 1.',
        mutations: ['maxAutoPromoteRiskClass: 2 → 1'],
        reversible: true,
      },
    },
  ],
  blockedReasons: [
    'triggerRollback: not auto-eligible.',
    'activateKillSwitch: not auto-eligible.',
    'notifyOperator: not auto-eligible.',
  ],
  guardResults: [
    {
      decision: 'continueRunning',
      summary: 'Metrics stable or improving — continue.',
      shouldFreezeAutonomy: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const actionTypeLabel: Record<string, string> = {
  tightenThreshold: 'Tighten Threshold',
  reduceRollout: 'Reduce Rollout',
  pauseRollout: 'Pause Rollout',
  disableAutoPromote: 'Disable Auto-Promote',
  increaseSampleRequirement: 'Increase Samples',
};

const guardDecisionColor: Record<string, string> = {
  continueRunning: 'bg-green-600 text-white',
  revertAction: 'bg-yellow-500 text-black',
  escalateToOperator: 'bg-red-600 text-white',
};

const guardDecisionLabel: Record<string, string> = {
  continueRunning: 'Continue',
  revertAction: 'Reverted',
  escalateToOperator: 'Escalated',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadges({ summary }: { summary: AutonomyDashboardSummary }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Badge className={summary.autonomyEnabled ? 'bg-green-600 text-white' : 'bg-gray-400'}>
        {summary.autonomyEnabled ? 'Enabled' : 'Disabled'}
      </Badge>
      {summary.autonomyFrozen && (
        <Badge className="bg-red-600 text-white animate-pulse">FROZEN</Badge>
      )}
    </div>
  );
}

function KpiRow({ summary }: { summary: AutonomyDashboardSummary }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Available Budget</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono">{summary.availableBudget}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Executed Today</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono text-green-600">{summary.actionsExecutedToday}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Blocked Today</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono text-yellow-600">{summary.blockedActionsToday}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Cooldown</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono">
          {summary.cooldownRemainingMinutes > 0
            ? <span className="text-orange-500">{summary.cooldownRemainingMinutes}m</span>
            : <span className="text-green-600">ready</span>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Status</CardTitle></CardHeader>
        <CardContent>
          <StatusBadges summary={summary} />
        </CardContent>
      </Card>
    </div>
  );
}

function RecentActionsTable({ actions }: { actions: AutonomyDashboardData['recentActions'] }) {
  if (actions.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No autonomous actions recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left py-1 pr-2">Action</th>
            <th className="text-left py-1 pr-2">Cohort</th>
            <th className="text-left py-1 pr-2">Rationale</th>
            <th className="text-right py-1 pr-2">Conf.</th>
            <th className="text-left py-1 pr-2">Timestamp</th>
            <th className="text-center py-1 pr-2">Reversible</th>
            <th className="text-left py-1">Result</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.actionId} className="border-b last:border-0">
              <td className="py-1 pr-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {actionTypeLabel[a.actionType] ?? a.actionType}
                </Badge>
              </td>
              <td className="py-1 pr-2 font-mono">{a.cohortKey}</td>
              <td className="py-1 pr-2 max-w-xs truncate">{a.rationale}</td>
              <td className="py-1 pr-2 text-right font-mono">{(a.confidence * 100).toFixed(0)}%</td>
              <td className="py-1 pr-2 font-mono text-muted-foreground">
                {new Date(a.createdAt).toLocaleTimeString()}
              </td>
              <td className="py-1 pr-2 text-center">
                {a.result?.reversible ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">yes</Badge>
                ) : (
                  <Badge className="bg-gray-100 text-gray-600">—</Badge>
                )}
              </td>
              <td className="py-1">
                {a.result ? (
                  <span className={a.result.applied ? 'text-green-600' : 'text-muted-foreground'}>
                    {a.result.summary}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">pending</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockedReasonsPanel({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No blocked actions.</p>;
  }

  return (
    <ul className="space-y-1 text-sm">
      {reasons.map((r, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="text-yellow-500 mt-0.5">●</span>
          <span>{r}</span>
        </li>
      ))}
    </ul>
  );
}

function GuardOutcomesPanel({ results }: { results: GuardResult[] }) {
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No guard evaluations yet.</p>;
  }

  return (
    <div className="space-y-2">
      {results.map((r, i) => (
        <div key={i} className="flex items-start gap-3">
          <Badge className={guardDecisionColor[r.decision] ?? 'bg-gray-400'}>
            {guardDecisionLabel[r.decision] ?? r.decision}
          </Badge>
          <div className="flex-1">
            <p className="text-sm">{r.summary}</p>
            {r.shouldFreezeAutonomy && (
              <p className="text-xs text-red-500 font-semibold mt-1">Autonomy freeze triggered</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AutonomyPage() {
  const [data, setData] = useState<AutonomyDashboardData>(FALLBACK_DATA);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        const res = await fetch('/api/optimizer/autonomy');
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

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Autonomous Closed-Loop Execution</h1>
        <div className="flex items-center gap-3">
          {loading && <span className="text-xs text-muted-foreground animate-pulse">refreshing…</span>}
          <StatusBadges summary={data.summary} />
        </div>
      </div>

      {/* Safety notice */}
      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Only bounded protective actions are automated. No autonomous relaxation in MVP.
          An operator can disable autonomy at any time.
        </p>
      </div>

      {/* Frozen banner */}
      {data.summary.autonomyFrozen && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">
            Autonomy is FROZEN — repeated failures detected. Manual operator review required.
          </p>
        </div>
      )}

      {/* KPI row */}
      <KpiRow summary={data.summary} />

      {/* Recent actions */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Recent Autonomous Actions{' '}
          <Badge variant="outline" className="ml-2">{data.recentActions.length}</Badge>
        </h2>
        <Card>
          <CardContent className="py-4">
            <RecentActionsTable actions={data.recentActions} />
          </CardContent>
        </Card>
      </section>

      {/* Blocked actions */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Blocked Actions{' '}
          <Badge variant="outline" className="ml-2">{data.blockedReasons.length}</Badge>
        </h2>
        <Card>
          <CardContent className="py-4">
            <BlockedReasonsPanel reasons={data.blockedReasons} />
          </CardContent>
        </Card>
      </section>

      {/* Guard outcomes */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Guard Outcomes</h2>
        <Card>
          <CardContent className="py-4">
            <GuardOutcomesPanel results={data.guardResults} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
