"use client";

import { useEffect, useState, useCallback } from "react";
import { pilotApiUrl } from "@/lib/shared/pilot-api";
import { CommanderInput } from "@/components/CommanderInput";

interface RecentCommand {
  missionId: string;
  goal: string;
  status: string;
  createdAt: string;
}

interface SummaryPayload {
  generatedAt: string;
  autonomy: {
    enabled: boolean;
    confidence: number;
    openRisks: number;
    recommendedActions: number;
    topSignal: { type: string; summary: string } | null;
  };
  operations: {
    queuedMissions: number;
    runningMissions: number;
    openApprovals: number;
    failedQueue: number;
  };
  inventory: {
    path: string;
    generatedAt: string | null;
    ageMinutes: number | null;
    stale: boolean;
    counts: {
      tenants: number;
      pods: number;
      domains: number;
      services: number;
      edges: number;
    };
    error: string | null;
  };
  commandCenter: {
    executedRuns: number;
    failedRuns: number;
    recentActivity: Array<{ eventId: string; title: string; detail?: string; ts: string }>;
  };
  strategy: Array<{ id: string; title: string; summary: string; priority: number }>;
  actions: Array<{ id: string; type: string; targetSystem: string; executionStatus: string; suggestedCommand?: string; risk: { level: string } }>;
  commands: string[];
}

const STATUS_COLORS: Record<string, string> = {
  proposed: "#3b82f6",
  pending: "#f59e0b",
  running: "#22c55e",
  completed: "#10b981",
  failed: "#ef4444",
  canceled: "#888",
};

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - Date.parse(ts)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#888";
  return (
    <span
      style={{
        fontSize: "0.7rem",
        padding: "0.1rem 0.5rem",
        borderRadius: 10,
        border: `1px solid ${color}`,
        color,
        marginLeft: "0.5rem",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div style={{ padding: "0.9rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
      <div style={{ fontSize: "0.72rem", color: "#8b93a7", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: tone ?? "#f5f7fb" }}>{value}</div>
    </div>
  );
}

export default function CommanderPage() {
  const [recent, setRecent] = useState<RecentCommand[]>([]);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch(pilotApiUrl("/api/mission/list?limit=10"));
      const json = await res.json();
      if (json.ok && json.data?.missions) {
        setRecent(
          json.data.missions
            .filter((m: any) => m.tags?.includes?.("commander") || m.origin?.source === "manual")
            .slice(0, 10)
            .map((m: any) => ({
              missionId: m.missionId,
              goal: m.goal,
              status: m.status,
              createdAt: m.createdAt,
            })),
        );
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(pilotApiUrl("/api/command-center/summary"), { cache: "no-store" });
      const json = await res.json();
      if (json.ok && json.data) {
        setSummary(json.data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void Promise.all([fetchRecent(), fetchSummary()]);
  }, [fetchRecent, fetchSummary]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem 1rem", display: "grid", gap: "1.25rem" }}>
      <div>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.25rem" }}>MigraCommand Center</h1>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Unified operator view for autonomy, commands, activity, and cross-system execution.
        </p>
      </div>

      <CommanderInput onResult={() => void Promise.all([fetchRecent(), fetchSummary()])} />

      {summary ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "0.75rem" }}>
            <MetricCard label="Autonomy Confidence" value={`${Math.round(summary.autonomy.confidence * 100)}%`} tone={summary.autonomy.confidence >= 0.8 ? "#10b981" : summary.autonomy.confidence >= 0.5 ? "#f59e0b" : "#ef4444"} />
            <MetricCard label="Open Risks" value={summary.autonomy.openRisks} tone={summary.autonomy.openRisks > 0 ? "#ef4444" : "#10b981"} />
            <MetricCard label="Open Approvals" value={summary.operations.openApprovals} tone={summary.operations.openApprovals > 0 ? "#f59e0b" : "#10b981"} />
            <MetricCard label="Executed Runs" value={summary.commandCenter.executedRuns} tone="#38bdf8" />
            <MetricCard label="Inventory Freshness" value={summary.inventory.ageMinutes === null ? "unknown" : `${summary.inventory.ageMinutes}m`} tone={summary.inventory.stale ? "#ef4444" : "#10b981"} />
          </div>

          <div style={{ padding: "0.9rem 1rem", borderRadius: 10, border: `1px solid ${summary.inventory.stale ? "rgba(239,68,68,0.28)" : "rgba(16,185,129,0.22)"}`, background: summary.inventory.stale ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "0.78rem", color: "#8b93a7", marginBottom: 4 }}>Inventory Status</div>
                <div style={{ fontWeight: 700, color: summary.inventory.stale ? "#fca5a5" : "#86efac" }}>
                  {summary.inventory.stale ? "Stale inventory detected" : "Inventory refresh healthy"}
                </div>
                <div style={{ fontSize: "0.82rem", color: "#b7bfd1", marginTop: 4 }}>
                  {summary.inventory.generatedAt ? `Last refresh ${new Date(summary.inventory.generatedAt).toLocaleString()}` : "No inventory timestamp available"}
                  {summary.inventory.error ? ` · ${summary.inventory.error}` : ""}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, max-content))", gap: "0.75rem 1rem", fontSize: "0.78rem", color: "#dbe2f2" }}>
                <div>Services: {summary.inventory.counts.services}</div>
                <div>Pods: {summary.inventory.counts.pods}</div>
                <div>Tenants: {summary.inventory.counts.tenants}</div>
                <div>Domains: {summary.inventory.counts.domains}</div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1rem" }}>
            <div style={{ padding: "1rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Strategy Panel</h2>
                <span style={{ fontSize: "0.75rem", color: "#8b93a7" }}>{new Date(summary.generatedAt).toLocaleString()}</span>
              </div>
              {summary.autonomy.topSignal ? (
                <div style={{ marginBottom: 12, padding: "0.75rem", borderRadius: 8, border: "1px solid rgba(56,189,248,0.18)", background: "rgba(56,189,248,0.06)" }}>
                  <div style={{ fontSize: "0.75rem", color: "#8b93a7", marginBottom: 4 }}>Top Signal</div>
                  <div style={{ fontWeight: 600 }}>{summary.autonomy.topSignal.type}</div>
                  <div style={{ fontSize: "0.82rem", color: "#b7bfd1", marginTop: 4 }}>{summary.autonomy.topSignal.summary}</div>
                </div>
              ) : null}
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {summary.strategy.map((item) => (
                  <div key={item.id} style={{ paddingBottom: "0.75rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontWeight: 600 }}>{item.title}</div>
                      <div style={{ fontSize: "0.72rem", color: "#8b93a7" }}>P{item.priority}</div>
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#b7bfd1", marginTop: 4 }}>{item.summary}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: "1rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginTop: 0, marginBottom: 12 }}>Action Orchestrator</h2>
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {summary.actions.map((action) => (
                  <div key={action.id} style={{ paddingBottom: "0.75rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontWeight: 600 }}>{action.type}</div>
                      <div style={{ fontSize: "0.72rem", color: action.risk.level === "LOW" ? "#10b981" : action.risk.level === "MEDIUM" ? "#f59e0b" : "#ef4444" }}>{action.risk.level}</div>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#8b93a7", marginTop: 4 }}>{action.targetSystem} · {action.executionStatus}</div>
                    {action.suggestedCommand ? <div style={{ fontFamily: "monospace", fontSize: "0.75rem", marginTop: 4, color: "#dbe2f2" }}>{action.suggestedCommand}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div style={{ padding: "1rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginTop: 0, marginBottom: 12 }}>Activity Timeline</h2>
              <div style={{ display: "grid", gap: "0.7rem" }}>
                {summary.commandCenter.recentActivity.map((item) => (
                  <div key={item.eventId} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "0.7rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{item.title}</div>
                    {item.detail ? <div style={{ fontSize: "0.8rem", color: "#b7bfd1", marginTop: 4 }}>{item.detail}</div> : null}
                    <div style={{ fontSize: "0.72rem", color: "#8b93a7", marginTop: 4 }}>{timeAgo(item.ts)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: "1rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginTop: 0, marginBottom: 12 }}>Recent Commands</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem" }}>
                {recent.map((cmd) => (
                  <a
                    key={cmd.missionId}
                    href={`/missions/${cmd.missionId}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.5rem 0.75rem",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.02)",
                      textDecoration: "none",
                      color: "#ddd",
                      fontSize: "0.82rem",
                    }}
                  >
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cmd.goal}</span>
                    <StatusBadge status={cmd.status} />
                  </a>
                ))}
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "#8b93a7", marginBottom: 8 }}>Supported Autonomy Commands</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {summary.commands.map((command) => (
                    <div key={command} style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#dbe2f2" }}>{command}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
