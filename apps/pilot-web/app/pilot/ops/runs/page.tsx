"use client";

import { useEffect, useState } from "react";

/* ── Types ── */
interface RunRow {
  id: string;
  pilotRunId: string | null;
  conversationId: string;
  actorId: string;
  model: string;
  tier: string;
  status: string;
  userMessage: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimateUsd: number;
  toolCallCount: number;
  iterationCount: number;
  escalationReason: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string;
  endedAt: string | null;
  trustScore: number;
  trustLabel: string | null;
}

interface JournalStats {
  total: number;
  byStatus: Record<string, number>;
  byTier: { tier: string; count: number; totalTokens: number; costUsd: number }[];
  totals: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; toolCalls: number };
  averages: { durationMs: number; tokensPerRun: number };
}

const API = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://localhost:3377";

/* ── Helpers ── */
function fmtDate(s: string) { return new Date(s).toLocaleString(); }
function fmtDuration(ms: number | null) { return ms != null ? `${(ms / 1000).toFixed(1)}s` : "—"; }
function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

function statusColor(s: string) {
  switch (s) {
    case "COMPLETED": return "var(--success)";
    case "FAILED": return "var(--danger)";
    case "RUNNING": return "var(--accent)";
    case "TIMED_OUT": return "var(--warning)";
    default: return "var(--fg-dim)";
  }
}

function tierBadge(tier: string) {
  const colors: Record<string, string> = {
    LOCAL: "var(--fg-dim)",
    SONNET: "var(--accent)",
    OPUS: "#e8823a",
  };
  return (
    <span style={{
      color: colors[tier] ?? "var(--fg)",
      background: "rgba(255,255,255,0.06)",
      padding: "2px 8px",
      borderRadius: "4px",
      fontSize: "11px",
      fontWeight: 500,
    }}>
      {tier}
    </span>
  );
}

function trustColor(label: string | null, score: number) {
  if (label === "HIGH" || score >= 80) return "#4ec9b0";
  if (label === "MEDIUM" || score >= 50) return "#dcdcaa";
  return "#f14c4c";
}

function trustBadge(score: number, label: string | null) {
  const color = trustColor(label, score);
  return (
    <span style={{
      color,
      background: `${color}18`,
      padding: "2px 8px",
      borderRadius: "4px",
      fontSize: "11px",
      fontWeight: 600,
      fontFamily: "var(--mono)",
    }}>
      {score}
    </span>
  );
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/pilot/journal/runs?limit=100`).then(r => r.json()),
      fetch(`${API}/api/pilot/journal/stats`).then(r => r.json()),
    ])
      .then(([runsRes, statsRes]) => {
        if (runsRes.ok) setRuns(runsRes.runs);
        else setError(runsRes.error ?? "Failed to load runs");
        if (statsRes.ok) setStats(statsRes.stats);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 24, color: "var(--fg-dim)" }}>Loading execution runs…</div>;
  if (error) return <div style={{ padding: 24, color: "var(--danger)" }}>Error: {error}</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--fg-bright)", margin: 0 }}>Execution Runs</h1>
        <p style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 4 }}>
          Full timeline + context snapshot for every MigraPilot operation.
        </p>
      </div>

      {/* ── Stats cards ── */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Total Runs", value: stats.total },
            { label: "Total Tokens", value: fmtTokens(stats.totals.totalTokens) },
            { label: "Avg Duration", value: fmtDuration(stats.averages.durationMs) },
            { label: "Tool Calls", value: stats.totals.toolCalls },
            { label: "Avg Tokens/Run", value: fmtTokens(stats.averages.tokensPerRun) },
          ].map(c => (
            <div key={c.label} style={{
              background: "var(--bg-sidebar)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 16px",
            }}>
              <div style={{ fontSize: 11, color: "var(--fg-dim)", marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: "var(--fg-bright)" }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Runs table ── */}
      <div style={{
        background: "var(--bg-sidebar)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}>
        {/* Header row */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 0.7fr 0.5fr 0.5fr 1fr 0.6fr 0.8fr 0.6fr",
          gap: 8,
          padding: "10px 16px",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--fg-dim)",
          background: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid var(--border)",
        }}>
          <div>Run</div>
          <div>Status</div>
          <div>Trust</div>
          <div>Tier</div>
          <div>Actor</div>
          <div style={{ textAlign: "right" }}>Tokens</div>
          <div style={{ textAlign: "right" }}>Duration</div>
          <div style={{ textAlign: "right" }}>Tools</div>
        </div>

        {runs.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--fg-dim)" }}>No runs yet.</div>
        )}

        {runs.map(r => (
          <a
            key={r.id}
            href={`/pilot/ops/runs/${r.id}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 0.7fr 0.5fr 0.5fr 1fr 0.6fr 0.8fr 0.6fr",
              gap: 8,
              padding: "10px 16px",
              borderTop: "1px solid var(--border)",
              textDecoration: "none",
              color: "var(--fg)",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-bright)" }}>
                {r.id.slice(0, 12)}…
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-dim)" }}>{fmtDate(r.startedAt)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ color: statusColor(r.status), fontSize: 12, fontWeight: 500 }}>{r.status}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>{trustBadge(r.trustScore, r.trustLabel)}</div>
            <div style={{ display: "flex", alignItems: "center" }}>{tierBadge(r.tier)}</div>
            <div style={{ fontSize: 12, color: "var(--fg-dim)", display: "flex", alignItems: "center" }}>{r.actorId}</div>
            <div style={{ fontSize: 12, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>{fmtTokens(r.totalTokens)}</div>
            <div style={{ fontSize: 12, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>{fmtDuration(r.durationMs)}</div>
            <div style={{ fontSize: 12, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>{r.toolCallCount}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
