'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PolicyOverride {
  overrideId: string;
  cohortKey: string;
  overrides: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
  reason?: string;
  revoked: boolean;
}

interface OperatorActionLogEntry {
  entryId: string;
  actor: string;
  actionType: string;
  timestamp: string;
  policyVersion?: string;
  note?: string;
}

interface IncidentReviewSession {
  sessionId: string;
  policyVersion: string;
  cohortKey: string;
  relatedEvents: string[];
  summary: string;
  createdAt: string;
  createdBy: string;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  notes: string[];
  closedAt?: string;
  resolution?: string;
}

interface ControlCenterSnapshot {
  activePolicyVersion: string;
  cohortKey: string;
  autonomyEnabled: boolean;
  autonomyFrozen: boolean;
  activeWarnings: number;
  activeRecommendations: number;
  runningExperiments: number;
  overrides: PolicyOverride[];
  openIncidents: number;
}

interface ControlCenterDashboard {
  snapshot: ControlCenterSnapshot;
  recentOperatorActions: OperatorActionLogEntry[];
  activeOverrides: PolicyOverride[];
  openIncidents: IncidentReviewSession[];
}

// ---------------------------------------------------------------------------
// Fallback data
// ---------------------------------------------------------------------------

const FALLBACK_DATA: ControlCenterDashboard = {
  snapshot: {
    activePolicyVersion: 'pol-v14',
    cohortKey: 'web-users',
    autonomyEnabled: true,
    autonomyFrozen: false,
    activeWarnings: 2,
    activeRecommendations: 3,
    runningExperiments: 1,
    overrides: [],
    openIncidents: 1,
  },
  recentOperatorActions: [
    {
      entryId: 'op_freezeAutonomy_1736683200000',
      actor: 'ops-admin',
      actionType: 'freezeAutonomy',
      timestamp: '2026-01-12T10:00:00Z',
      note: 'Precautionary freeze during deploy window',
    },
    {
      entryId: 'op_resumeAutonomy_1736686800000',
      actor: 'ops-admin',
      actionType: 'resumeAutonomy',
      timestamp: '2026-01-12T11:00:00Z',
    },
  ],
  activeOverrides: [
    {
      overrideId: 'ovr_web-users_1736680000000',
      cohortKey: 'web-users',
      overrides: { freezeRollout: true },
      expiresAt: '2026-01-12T14:00:00Z',
      createdAt: '2026-01-12T10:00:00Z',
      createdBy: 'ops-admin',
      reason: 'Deploy window protection',
      revoked: false,
    },
  ],
  openIncidents: [
    {
      sessionId: 'inc_web-users_1736683200000',
      policyVersion: 'pol-v14',
      cohortKey: 'web-users',
      relatedEvents: ['evt_001', 'evt_002'],
      summary: 'Elevated crash rate after v14 rollout to 30%',
      createdAt: '2026-01-12T10:00:00Z',
      createdBy: 'ops-admin',
      status: 'investigating',
      notes: ['Correlates with backend deploy at 09:45'],
      resolution: '',
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusColor: Record<string, string> = {
  open: 'bg-red-600 text-white',
  investigating: 'bg-yellow-500 text-black',
  resolved: 'bg-blue-500 text-white',
  closed: 'bg-gray-400 text-white',
};

const actionTypeLabel: Record<string, string> = {
  freezeAutonomy: 'Freeze Autonomy',
  resumeAutonomy: 'Resume Autonomy',
  forcePromotePolicy: 'Force Promote',
  rollbackPolicy: 'Rollback Policy',
  cancelExperiment: 'Cancel Experiment',
  applyRecommendation: 'Apply Recommendation',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function minutesUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GlobalStatusBar({ snapshot }: { snapshot: ControlCenterSnapshot }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Badge variant="outline" className="text-sm">
        Policy: <span className="font-mono ml-1">{snapshot.activePolicyVersion}</span>
      </Badge>
      <Badge className={snapshot.autonomyEnabled ? 'bg-green-600 text-white' : 'bg-gray-400'}>
        Autonomy {snapshot.autonomyEnabled ? 'ON' : 'OFF'}
      </Badge>
      {snapshot.autonomyFrozen && (
        <Badge className="bg-red-600 text-white animate-pulse">FROZEN</Badge>
      )}
      {snapshot.activeWarnings > 0 && (
        <Badge className="bg-yellow-500 text-black">
          {snapshot.activeWarnings} Warning{snapshot.activeWarnings !== 1 ? 's' : ''}
        </Badge>
      )}
      {snapshot.openIncidents > 0 && (
        <Badge className="bg-red-500 text-white">
          {snapshot.openIncidents} Incident{snapshot.openIncidents !== 1 ? 's' : ''}
        </Badge>
      )}
    </div>
  );
}

function KpiRow({ snapshot }: { snapshot: ControlCenterSnapshot }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Warnings</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono text-yellow-600">{snapshot.activeWarnings}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Recommendations</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono">{snapshot.activeRecommendations}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Experiments</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono">{snapshot.runningExperiments}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Overrides</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono text-orange-500">{snapshot.overrides.length}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">Open Incidents</CardTitle></CardHeader>
        <CardContent className="text-lg font-mono text-red-500">{snapshot.openIncidents}</CardContent>
      </Card>
    </div>
  );
}

function ActionsPanel() {
  const buttons = [
    { label: 'Freeze Autonomy', action: 'freezeAutonomy', color: 'bg-red-600 hover:bg-red-700' },
    { label: 'Resume Autonomy', action: 'resumeAutonomy', color: 'bg-green-600 hover:bg-green-700' },
    { label: 'Rollback Policy', action: 'rollbackPolicy', color: 'bg-yellow-600 hover:bg-yellow-700' },
    { label: 'Promote Candidate', action: 'forcePromotePolicy', color: 'bg-blue-600 hover:bg-blue-700' },
  ];

  return (
    <Card>
      <CardHeader><CardTitle>Operator Actions</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {buttons.map((btn) => (
            <button
              key={btn.action}
              className={`${btn.color} text-white text-sm font-medium px-4 py-2 rounded-md transition-colors`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OperatorLog({ actions }: { actions: OperatorActionLogEntry[] }) {
  if (actions.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Recent Operator Actions</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2">Time</th>
              <th className="pb-2">Actor</th>
              <th className="pb-2">Action</th>
              <th className="pb-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.entryId} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs">{fmtTime(a.timestamp)}</td>
                <td className="py-2">{a.actor}</td>
                <td className="py-2">
                  <Badge variant="outline">{actionTypeLabel[a.actionType] ?? a.actionType}</Badge>
                </td>
                <td className="py-2 text-muted-foreground">{a.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function OverridesPanel({ overrides }: { overrides: PolicyOverride[] }) {
  if (overrides.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Active Overrides</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No active overrides.</p></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Active Overrides</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-3">
          {overrides.map((o) => (
            <div key={o.overrideId} className="border rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">{o.cohortKey}</span>
                <Badge className="bg-orange-500 text-white">
                  Expires in {minutesUntil(o.expiresAt)}m
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {Object.keys(o.overrides).join(', ')} — by {o.createdBy}
                {o.reason ? ` (${o.reason})` : ''}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function IncidentPanel({ incidents }: { incidents: IncidentReviewSession[] }) {
  if (incidents.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Incident Workspace</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No open incidents.</p></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Incident Workspace</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          {incidents.map((inc) => (
            <div key={inc.sessionId} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{inc.summary}</span>
                <Badge className={statusColor[inc.status] ?? 'bg-gray-400'}>
                  {inc.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Policy: <span className="font-mono">{inc.policyVersion}</span> · Cohort: {inc.cohortKey}
                · Events: {inc.relatedEvents.length} · By: {inc.createdBy}
              </div>
              {inc.notes.length > 0 && (
                <div className="border-t pt-2 space-y-1">
                  {inc.notes.map((note, i) => (
                    <p key={i} className="text-xs text-muted-foreground">• {note}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ControlCenterPage() {
  const [data, setData] = useState<ControlCenterDashboard>(FALLBACK_DATA);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    // Future: fetch from /api/optimizer/control-center
    setData(FALLBACK_DATA);
    setLastRefresh(new Date());
  }, []);

  const { snapshot, recentOperatorActions, activeOverrides, openIncidents } = data;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Command Center</h1>
        <span className="text-xs text-muted-foreground">
          Last refresh: {lastRefresh.toLocaleTimeString()}
        </span>
      </div>

      <GlobalStatusBar snapshot={snapshot} />
      <KpiRow snapshot={snapshot} />
      <ActionsPanel />
      <OperatorLog actions={recentOperatorActions} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <OverridesPanel overrides={activeOverrides} />
        <IncidentPanel incidents={openIncidents} />
      </div>
    </div>
  );
}
