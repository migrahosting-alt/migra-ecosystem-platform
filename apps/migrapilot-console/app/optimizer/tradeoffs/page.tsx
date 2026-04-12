'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ObjectiveWeights {
  safety: number;
  speed: number;
  support: number;
  stability: number;
}

interface MultiObjectiveScore {
  policyVersion: string;
  safetyScore: number;
  speedScore: number;
  supportScore: number;
  stabilityScore: number;
  totalScore: number;
}

interface ParetoCandidate {
  policyVersion: string;
  metrics: Record<string, number>;
  isDominated: boolean;
}

interface ObjectiveTradeoff {
  objectiveName: string;
  direction: 'improving' | 'neutral' | 'worsening';
  delta: number;
}

interface TradeoffAnalysis {
  fromPolicy: string;
  toPolicy: string;
  tradeoffs: ObjectiveTradeoff[];
  netChange: number;
  hasConflict: boolean;
}

// ---------------------------------------------------------------------------
// Fallback data
// ---------------------------------------------------------------------------

const FALLBACK_CANDIDATES: MultiObjectiveScore[] = [
  { policyVersion: 'pol-v14', safetyScore: 0.92, speedScore: 0.65, supportScore: 0.88, stabilityScore: 0.80, totalScore: 0.8125 },
  { policyVersion: 'pol-v13', safetyScore: 0.85, speedScore: 0.78, supportScore: 0.75, stabilityScore: 0.90, totalScore: 0.82 },
  { policyVersion: 'pol-v12', safetyScore: 0.78, speedScore: 0.85, supportScore: 0.70, stabilityScore: 0.72, totalScore: 0.7625 },
  { policyVersion: 'pol-v11', safetyScore: 0.70, speedScore: 0.90, supportScore: 0.60, stabilityScore: 0.65, totalScore: 0.7125 },
];

const FALLBACK_PARETO: ParetoCandidate[] = [
  { policyVersion: 'pol-v14', metrics: { safety: 0.92, speed: 0.65, support: 0.88, stability: 0.80 }, isDominated: false },
  { policyVersion: 'pol-v13', metrics: { safety: 0.85, speed: 0.78, support: 0.75, stability: 0.90 }, isDominated: false },
  { policyVersion: 'pol-v12', metrics: { safety: 0.78, speed: 0.85, support: 0.70, stability: 0.72 }, isDominated: true },
  { policyVersion: 'pol-v11', metrics: { safety: 0.70, speed: 0.90, support: 0.60, stability: 0.65 }, isDominated: true },
];

const FALLBACK_TRADEOFFS: TradeoffAnalysis[] = [
  {
    fromPolicy: 'pol-v14',
    toPolicy: 'pol-v13',
    tradeoffs: [
      { objectiveName: 'safety', direction: 'worsening', delta: -0.07 },
      { objectiveName: 'speed', direction: 'improving', delta: 0.13 },
      { objectiveName: 'support', direction: 'worsening', delta: -0.13 },
      { objectiveName: 'stability', direction: 'improving', delta: 0.10 },
    ],
    netChange: 0.0075,
    hasConflict: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const directionColor: Record<string, string> = {
  improving: 'text-green-600',
  neutral: 'text-gray-400',
  worsening: 'text-red-600',
};

const directionIcon: Record<string, string> = {
  improving: '↑',
  neutral: '—',
  worsening: '↓',
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function scoreBar(v: number): React.ReactNode {
  const width = Math.round(v * 100);
  const color = v >= 0.8 ? 'bg-green-500' : v >= 0.6 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs font-mono">{pct(v)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WeightSliders({
  weights,
  onChange,
}: {
  weights: ObjectiveWeights;
  onChange: (key: keyof ObjectiveWeights, value: number) => void;
}) {
  const objectives: { key: keyof ObjectiveWeights; label: string }[] = [
    { key: 'safety', label: 'Safety' },
    { key: 'speed', label: 'Speed' },
    { key: 'support', label: 'Support' },
    { key: 'stability', label: 'Stability' },
  ];

  return (
    <Card>
      <CardHeader><CardTitle>Objective Weights</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          {objectives.map((obj) => (
            <div key={obj.key} className="flex items-center gap-4">
              <span className="w-20 text-sm font-medium">{obj.label}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(weights[obj.key] * 100)}
                onChange={(e) => onChange(obj.key, parseInt(e.target.value) / 100)}
                className="flex-1 h-2 accent-blue-600"
              />
              <span className="w-12 text-right font-mono text-sm">{pct(weights[obj.key])}</span>
            </div>
          ))}
          <div className="text-xs text-muted-foreground text-right">
            Sum: {pct(weights.safety + weights.speed + weights.support + weights.stability)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ParetoFrontierPanel({ candidates }: { candidates: ParetoCandidate[] }) {
  const frontier = candidates.filter((c) => !c.isDominated);
  const dominated = candidates.filter((c) => c.isDominated);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pareto Frontier ({frontier.length} optimal)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {candidates.map((c) => (
            <div
              key={c.policyVersion}
              className={`border rounded-md p-3 flex items-center justify-between ${
                c.isDominated ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">{c.policyVersion}</span>
                {!c.isDominated && (
                  <Badge className="bg-blue-600 text-white text-xs">Optimal</Badge>
                )}
                {c.isDominated && (
                  <Badge variant="outline" className="text-xs">Dominated</Badge>
                )}
              </div>
              <div className="flex gap-4 text-xs font-mono">
                {Object.entries(c.metrics).map(([k, v]) => (
                  <span key={k}>{k}: {pct(v)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TradeoffMatrix({ tradeoffs }: { tradeoffs: TradeoffAnalysis[] }) {
  if (tradeoffs.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Tradeoff Analysis</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          {tradeoffs.map((t) => (
            <div key={`${t.fromPolicy}-${t.toPolicy}`} className="border rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">
                  <span className="font-mono">{t.fromPolicy}</span>
                  {' → '}
                  <span className="font-mono">{t.toPolicy}</span>
                </span>
                <div className="flex items-center gap-2">
                  <Badge
                    className={
                      t.netChange > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }
                  >
                    Net: {t.netChange > 0 ? '+' : ''}{pct(t.netChange)}
                  </Badge>
                  {t.hasConflict && (
                    <Badge className="bg-yellow-100 text-yellow-700">Conflict</Badge>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {t.tradeoffs.map((to) => (
                  <div key={to.objectiveName} className="flex items-center gap-1">
                    <span className={directionColor[to.direction]}>
                      {directionIcon[to.direction]}
                    </span>
                    <span className="capitalize">{to.objectiveName}</span>
                    <span className={`font-mono ${directionColor[to.direction]}`}>
                      {to.delta > 0 ? '+' : ''}{pct(to.delta)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CandidateTable({ candidates }: { candidates: MultiObjectiveScore[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Ranked Candidates</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2">#</th>
              <th className="pb-2">Policy</th>
              <th className="pb-2">Safety</th>
              <th className="pb-2">Speed</th>
              <th className="pb-2">Support</th>
              <th className="pb-2">Stability</th>
              <th className="pb-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => (
              <tr key={c.policyVersion} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="py-2 font-mono">{c.policyVersion}</td>
                <td className="py-2">{scoreBar(c.safetyScore)}</td>
                <td className="py-2">{scoreBar(c.speedScore)}</td>
                <td className="py-2">{scoreBar(c.supportScore)}</td>
                <td className="py-2">{scoreBar(c.stabilityScore)}</td>
                <td className="py-2 font-mono font-bold">{pct(c.totalScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function TradeoffsPage() {
  const [weights, setWeights] = useState<ObjectiveWeights>({
    safety: 0.25,
    speed: 0.25,
    support: 0.25,
    stability: 0.25,
  });

  const handleWeightChange = (key: keyof ObjectiveWeights, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }));
  };

  // In production, re-rank on weight change. For now, use fallback.
  const rankedCandidates = useMemo(() => {
    // Re-score with current weights
    return FALLBACK_CANDIDATES.map((c) => ({
      ...c,
      totalScore:
        c.safetyScore * weights.safety +
        c.speedScore * weights.speed +
        c.supportScore * weights.support +
        c.stabilityScore * weights.stability,
    })).sort((a, b) => b.totalScore - a.totalScore);
  }, [weights]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold">Multi-Objective Tradeoffs</h1>

      <WeightSliders weights={weights} onChange={handleWeightChange} />
      <ParetoFrontierPanel candidates={FALLBACK_PARETO} />
      <TradeoffMatrix tradeoffs={FALLBACK_TRADEOFFS} />
      <CandidateTable candidates={rankedCandidates} />
    </div>
  );
}
