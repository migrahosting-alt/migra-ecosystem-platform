'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchOptimizer } from '@/lib/api/optimizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PolicyProfile {
  version: string;
  parentVersion?: string | null;
  minSampledSessions: number;
  minTelemetryCoverage: number;
  crashRateRollbackThreshold: number;
  crashRateKillSwitchThreshold: number;
  maxP0BeforeRollback: number;
  maxSnapshotAgeMinutes: number;
  promoteSoakMinutes: number;
  maxAutoPromoteRiskClass: number;
}

type LifecycleState =
  | 'draft'
  | 'pendingApproval'
  | 'approved'
  | 'rejected'
  | 'promoted'
  | 'archived'
  | 'rolledBack';

interface RegisteredPolicy {
  policyId: string;
  profile: PolicyProfile;
  lifecycleState: LifecycleState;
  createdBy: string;
  createdAt: string;
  isActive: boolean;
  approvalNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionNote?: string;
  promotedBy?: string;
  promotedAt?: string;
}

interface HistoryEntry {
  entryId: string;
  policyId: string;
  version: string;
  action: string;
  actor: string;
  note: string;
  timestamp: string;
}

interface MutationRow {
  action: string;
  field: string;
  beforeValue: string;
  afterValue: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleActive: RegisteredPolicy = {
  policyId: 'pol-001',
  profile: {
    version: 'v1',
    parentVersion: null,
    minSampledSessions: 50,
    minTelemetryCoverage: 0.8,
    crashRateRollbackThreshold: 0.02,
    crashRateKillSwitchThreshold: 0.05,
    maxP0BeforeRollback: 3,
    maxSnapshotAgeMinutes: 15,
    promoteSoakMinutes: 60,
    maxAutoPromoteRiskClass: 0,
  },
  lifecycleState: 'promoted',
  createdBy: 'system',
  createdAt: '2026-04-08T10:00:00Z',
  isActive: true,
  promotedBy: 'admin',
  promotedAt: '2026-04-08T12:00:00Z',
};

const sampleCandidate: RegisteredPolicy = {
  policyId: 'pol-002',
  profile: {
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
  lifecycleState: 'pendingApproval',
  createdBy: 'optimizer',
  createdAt: '2026-04-09T08:00:00Z',
  isActive: false,
};

const sampleMutations: MutationRow[] = [
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
];

const sampleHistory: HistoryEntry[] = [
  {
    entryId: 'h-001',
    policyId: 'pol-002',
    version: 'v2',
    action: 'created',
    actor: 'optimizer',
    note: 'Generated v2 from v1 with 4 mutation(s) for safer optimization.',
    timestamp: '2026-04-09T08:00:00Z',
  },
  {
    entryId: 'h-002',
    policyId: 'pol-002',
    version: 'v2',
    action: 'submitted_for_approval',
    actor: 'optimizer',
    note: 'Submitted for review.',
    timestamp: '2026-04-09T08:01:00Z',
  },
];

const priorVersions: RegisteredPolicy[] = [sampleActive];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stateTone: Record<LifecycleState, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pendingApproval: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  promoted: 'bg-blue-50 text-blue-700',
  archived: 'bg-slate-100 text-slate-500',
  rolledBack: 'bg-purple-50 text-purple-700',
};

const stateLabel: Record<LifecycleState, string> = {
  draft: 'Draft',
  pendingApproval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  promoted: 'Promoted',
  archived: 'Archived',
  rolledBack: 'Rolled Back',
};

const actionTone: Record<string, string> = {
  created: 'bg-slate-100 text-slate-700',
  submitted_for_approval: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  promoted: 'bg-blue-50 text-blue-700',
  archived: 'bg-slate-100 text-slate-500',
  rollback_promoted: 'bg-purple-50 text-purple-700',
  changes_requested: 'bg-orange-50 text-orange-700',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Diff row
// ---------------------------------------------------------------------------

function DiffRow({
  field,
  before,
  after,
}: {
  field: string;
  before: string | number;
  after: string | number;
}) {
  const changed = String(before) !== String(after);
  return (
    <div
      className={`grid grid-cols-3 gap-4 border-b px-5 py-3 text-sm last:border-b-0 ${
        changed ? 'bg-blue-50/40' : ''
      }`}
    >
      <div className="font-medium text-slate-700">{field}</div>
      <div className="text-slate-500">{String(before)}</div>
      <div className={changed ? 'font-semibold text-slate-900' : 'text-slate-500'}>
        {String(after)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PolicyReviewDashboard() {
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOptimizer('/decisions').then(res => {
      if (cancelled) return;
      if (res.ok) setIsLive(true);
    });
    return () => { cancelled = true; };
  }, []);

  const active = sampleActive;
  const candidate = sampleCandidate;
  const mutations = sampleMutations;
  const history = sampleHistory;

  const [reviewNote, setReviewNote] = useState('');
  const [promotionNote, setPromotionNote] = useState('');
  const [activeTab, setActiveTab] = useState<
    'diff' | 'mutations' | 'history' | 'details'
  >('diff');
  const [rollbackVersion, setRollbackVersion] = useState('');

  const profileFields = useMemo(() => {
    const keys: (keyof PolicyProfile)[] = [
      'minSampledSessions',
      'minTelemetryCoverage',
      'crashRateRollbackThreshold',
      'crashRateKillSwitchThreshold',
      'maxP0BeforeRollback',
      'maxSnapshotAgeMinutes',
      'promoteSoakMinutes',
      'maxAutoPromoteRiskClass',
    ];
    return keys.map((k) => ({
      field: k,
      before: active.profile[k],
      after: candidate.profile[k],
    }));
  }, [active, candidate]);

  const isPending = candidate.lifecycleState === 'pendingApproval';
  const isApproved = candidate.lifecycleState === 'approved';

  const tabItems = [
    { key: 'diff' as const, label: 'Diff' },
    { key: 'mutations' as const, label: 'Mutations' },
    { key: 'history' as const, label: 'History' },
    { key: 'details' as const, label: 'Details' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">
              Policy Review
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Active: <span className="font-medium text-slate-700">{active.profile.version}</span>
              {' → '}
              Candidate: <span className="font-medium text-slate-700">{candidate.profile.version}</span>
            </p>
          </div>
          <Badge className={stateTone[candidate.lifecycleState]}>
            {stateLabel[candidate.lifecycleState]}
          </Badge>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="text-sm text-slate-500">Mutations</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {mutations.length}
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="text-sm text-slate-500">Goal</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">Safer</div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="text-sm text-slate-500">Confidence</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">72%</div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="text-sm text-slate-500">Created by</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {candidate.createdBy}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Approval panel */}
        {isPending && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Review Decision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                rows={3}
                placeholder="Reviewer note..."
              />
              <div className="flex gap-2">
                <button className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                  Approve
                </button>
                <button className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">
                  Reject
                </button>
                <button className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  Request Changes
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Promotion panel */}
        {isApproved && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Promote to Active</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                value={promotionNote}
                onChange={(e) => setPromotionNote(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                placeholder="Activation note..."
              />
              <button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Promote
              </button>
            </CardContent>
          </Card>
        )}

        {/* Rollback panel */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Rollback</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <select
                value={rollbackVersion}
                onChange={(e) => setRollbackVersion(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              >
                <option value="">Select prior version...</option>
                {priorVersions.map((p) => (
                  <option key={p.profile.version} value={p.profile.version}>
                    {p.profile.version} ({stateLabel[p.lifecycleState]})
                  </option>
                ))}
              </select>
              <button
                disabled={!rollbackVersion}
                className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-40"
              >
                Rollback
              </button>
            </div>
          </CardContent>
        </Card>

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

          {/* Diff tab */}
          {activeTab === 'diff' && (
            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="grid grid-cols-3 gap-4 border-b bg-slate-50 px-5 py-4 text-sm font-medium text-slate-600">
                <div>Field</div>
                <div>{active.profile.version} (active)</div>
                <div>{candidate.profile.version} (candidate)</div>
              </div>
              {profileFields.map((row) => (
                <DiffRow
                  key={row.field}
                  field={row.field}
                  before={row.before}
                  after={row.after}
                />
              ))}
            </div>
          )}

          {/* Mutations tab */}
          {activeTab === 'mutations' && (
            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="grid grid-cols-5 gap-4 border-b bg-slate-50 px-5 py-4 text-sm font-medium text-slate-600">
                <div>Action</div>
                <div>Field</div>
                <div>Before</div>
                <div>After</div>
                <div>Reason</div>
              </div>
              {mutations.map((row, idx) => (
                <div
                  key={`${row.field}-${idx}`}
                  className="grid grid-cols-5 gap-4 border-b px-5 py-4 text-sm last:border-b-0"
                >
                  <div>
                    <Badge className="bg-slate-100 text-slate-700">
                      {row.action}
                    </Badge>
                  </div>
                  <div className="font-medium text-slate-900">{row.field}</div>
                  <div className="text-slate-600">{row.beforeValue}</div>
                  <div className="text-slate-900">{row.afterValue}</div>
                  <div className="text-slate-600">{row.reason}</div>
                </div>
              ))}
              {mutations.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-slate-400">
                  No mutations.
                </div>
              )}
            </div>
          )}

          {/* History tab */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              {history.map((entry) => (
                <Card key={entry.entryId} className="rounded-2xl border-0 shadow-sm">
                  <CardContent className="flex items-start gap-4 p-5">
                    <div className="mt-0.5">
                      <Badge className={actionTone[entry.action] || 'bg-slate-100 text-slate-700'}>
                        {entry.action}
                      </Badge>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-900">
                        {entry.note}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {entry.actor} · {fmtDate(entry.timestamp)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {history.length === 0 && (
                <div className="py-8 text-center text-sm text-slate-400">
                  No history entries.
                </div>
              )}
            </div>
          )}

          {/* Details tab */}
          {activeTab === 'details' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(candidate.profile).map(([key, value]) => (
                <Card key={key} className="rounded-2xl border-0 shadow-sm">
                  <CardContent className="p-5">
                    <div className="text-sm text-slate-500">{key}</div>
                    <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                      {String(value ?? '—')}
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
