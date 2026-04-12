"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  fetchHealth,
  fetchCommands,
  fetchRuns,
  fetchPlan,
  executeCommand,
  type V1Health,
  type V1Command,
  type V1RunSummary,
  type V1PlanResponse,
  type V1ExecuteResponse,
} from "@/lib/api/pilotV1";

/* ── Helpers ── */

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "var(--ok)",
  FAILED: "var(--danger)",
  DENIED: "var(--warn)",
  EXECUTING: "var(--accent)",
  VERIFYING: "var(--accent)",
  REQUESTED: "var(--fg-dim)",
  VALIDATING: "var(--fg-dim)",
};

const RISK_LABEL: Record<number, { text: string; color: string }> = {
  0: { text: "Read-only", color: "var(--ok)" },
  1: { text: "Low Risk", color: "var(--warn)" },
  2: { text: "High Risk", color: "var(--danger)" },
};

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - Date.parse(ts)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ── Main Page ── */

export default function PilotDashboard() {
  const [health, setHealth] = useState<V1Health | null>(null);
  const [commands, setCommands] = useState<V1Command[]>([]);
  const [runs, setRuns] = useState<V1RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Command execution state
  const [selectedCmd, setSelectedCmd] = useState<string | null>(null);
  const [plan, setPlan] = useState<V1PlanResponse | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<V1ExecuteResponse | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [h, c, r] = await Promise.all([
        fetchHealth(),
        fetchCommands(),
        fetchRuns({ limit: 10 }),
      ]);
      setHealth(h);
      setCommands(c.commands);
      setRuns(r.runs);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const iv = setInterval(() => void loadData(), 30_000);
    return () => clearInterval(iv);
  }, [loadData]);

  async function handleSelectCommand(cmd: string) {
    setSelectedCmd(cmd);
    setExecResult(null);
    try {
      const p = await fetchPlan(cmd);
      setPlan(p);
    } catch {
      setPlan(null);
    }
  }

  async function handleExecute() {
    if (!selectedCmd) return;
    setExecuting(true);
    try {
      const result = await executeCommand(selectedCmd);
      setExecResult(result);
      // Refresh runs
      const r = await fetchRuns({ limit: 10 });
      setRuns(r.runs);
    } catch (err) {
      setExecResult({ ok: false, runId: "", command: selectedCmd, status: "FAILED", durationMs: 0, steps: [], denyReason: String(err) });
    } finally {
      setExecuting(false);
    }
  }

  if (loading) {
    return (
      <section className="panel" style={{ padding: 24 }}>
        <p style={{ color: "var(--fg-dim)" }}>Loading MigraPilot V1…</p>
      </section>
    );
  }

  return (
    <section style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text)" }}>
            MigraPilot <span style={{ color: "var(--accent)" }}>V1</span>
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--fg-dim)" }}>
            Operational command center — read-only diagnostics & safe operations
          </p>
        </div>
        <button
          onClick={() => void loadData()}
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            color: "var(--text-secondary)",
            padding: "6px 14px",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 8, padding: 12, marginBottom: 16, color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Health bar */}
      {health && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}>
          <HealthCard label="Platform" value={health.overall} color={health.overall === "healthy" ? "var(--ok)" : "var(--danger)"} />
          <HealthCard label="API" value={health.api.status} color={health.api.status === "UP" ? "var(--ok)" : "var(--danger)"} sub={`Uptime: ${formatMs(health.api.uptime * 1000)}`} />
          <HealthCard label="Database" value={health.database.status} color={health.database.status === "UP" ? "var(--ok)" : "var(--danger)"} sub={`Latency: ${health.database.latencyMs}ms`} />
          <HealthCard label="Operators" value={String(health.stats.operators)} color="var(--accent)" />
          <HealthCard label="Executions" value={String(health.stats.executionRuns)} color="var(--accent)" />
          <HealthCard label="Incidents" value={String(health.stats.activeIncidents)} color={health.stats.activeIncidents > 0 ? "var(--warn)" : "var(--ok)"} />
        </div>
      )}

      {/* Two column layout: commands + execution */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Commands */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Available Commands ({commands.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {commands.map((cmd) => {
              const risk = RISK_LABEL[cmd.riskTier] ?? { text: `Tier ${cmd.riskTier}`, color: "var(--fg-dim)" };
              const isSelected = selectedCmd === cmd.command;
              return (
                <button
                  key={cmd.command}
                  onClick={() => void handleSelectCommand(cmd.command)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: isSelected ? "var(--accent-glow-strong)" : "var(--bg-surface)",
                    border: isSelected ? "1px solid var(--accent)" : "1px solid var(--line)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 150ms",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", fontFamily: "var(--mono)" }}>
                      {cmd.command}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 2 }}>{cmd.description}</div>
                  </div>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: risk.color,
                    background: `${risk.color}18`,
                    padding: "2px 8px",
                    borderRadius: 4,
                    whiteSpace: "nowrap",
                  }}>
                    {risk.text}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Execution panel */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Execute Command
          </h3>

          {!selectedCmd && (
            <p style={{ color: "var(--fg-dim)", fontSize: 13, margin: 0 }}>
              Select a command from the left to see its plan and execute it.
            </p>
          )}

          {plan && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Plan summary */}
              <div style={{ background: "var(--bg-surface)", borderRadius: 8, padding: 12, border: "1px solid var(--line)" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", fontFamily: "var(--mono)" }}>
                  {plan.command}
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 4 }}>{plan.description}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <PlanBadge label="Risk" value={`Tier ${plan.riskTier}`} color={RISK_LABEL[plan.riskTier]?.color ?? "var(--fg-dim)"} />
                  <PlanBadge label="Cap" value={plan.requiredCapability} color="var(--accent)" />
                  <PlanBadge label="Mutating" value={plan.mutating ? "Yes" : "No"} color={plan.mutating ? "var(--warn)" : "var(--ok)"} />
                  <PlanBadge
                    label="Auth"
                    value={plan.authorized ? "Authorized" : "Denied"}
                    color={plan.authorized ? "var(--ok)" : "var(--danger)"}
                  />
                </div>
                {plan.denyReason && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--warn)", background: "var(--warn-bg)", padding: "6px 10px", borderRadius: 6 }}>
                    ⚠ {plan.denyReason}
                  </div>
                )}
              </div>

              {/* Execute button */}
              <button
                onClick={() => void handleExecute()}
                disabled={executing || !plan.authorized || plan.approvalRequired}
                style={{
                  background: plan.authorized && !plan.approvalRequired ? "var(--accent)" : "var(--panel-2)",
                  color: plan.authorized && !plan.approvalRequired ? "var(--bg)" : "var(--fg-dim)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: plan.authorized && !plan.approvalRequired ? "pointer" : "not-allowed",
                  opacity: executing ? 0.6 : 1,
                }}
              >
                {executing ? "Executing…" : plan.approvalRequired ? "Requires Approval" : plan.authorized ? `▶ Execute ${plan.command}` : "Not Authorized"}
              </button>

              {/* Execution result */}
              {execResult && (
                <div style={{
                  background: execResult.ok ? "var(--ok-bg)" : "var(--danger-bg)",
                  border: `1px solid ${execResult.ok ? "var(--ok)" : "var(--danger)"}`,
                  borderRadius: 8,
                  padding: 12,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: execResult.ok ? "var(--ok)" : "var(--danger)" }}>
                      {execResult.status}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>{formatMs(execResult.durationMs)}</span>
                  </div>
                  {execResult.runId && (
                    <Link
                      href={`/pilot/runs/${execResult.runId}`}
                      style={{ fontSize: 12, color: "var(--accent)", marginTop: 6, display: "inline-block" }}
                    >
                      View run details →
                    </Link>
                  )}
                  {execResult.denyReason && (
                    <p style={{ fontSize: 12, color: "var(--warn)", margin: "8px 0 0" }}>
                      {execResult.denyReason}
                    </p>
                  )}
                  {execResult.steps.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      {execResult.steps.map((s, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", color: s.status === "ok" ? "var(--ok)" : s.status === "failed" ? "var(--danger)" : "var(--fg-dim)" }}>
                          <span>{s.status === "ok" ? "✓" : s.status === "failed" ? "✗" : "○"}</span>
                          <span style={{ fontFamily: "var(--mono)" }}>{s.step}</span>
                          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--fg-dim)" }}>{formatMs(s.durationMs)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recent runs */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Recent Runs
          </h3>
          <Link href="/pilot/runs" style={{ fontSize: 12, color: "var(--accent)" }}>
            View all →
          </Link>
        </div>

        {runs.length === 0 ? (
          <p style={{ color: "var(--fg-dim)", fontSize: 13, margin: 0 }}>No execution runs yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/pilot/runs/${run.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 10px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  textDecoration: "none",
                  transition: "border-color 150ms",
                }}
              >
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: STATUS_COLOR[run.status] ?? "var(--fg-dim)",
                  flexShrink: 0,
                }} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.command}
                </span>
                <span style={{ fontSize: 11, color: STATUS_COLOR[run.status] ?? "var(--fg-dim)", fontWeight: 500 }}>
                  {run.status}
                </span>
                <span style={{ fontSize: 10, color: "var(--fg-dim)", flexShrink: 0 }}>
                  {formatMs(run.durationMs)}
                </span>
                <span style={{ fontSize: 10, color: "var(--fg-dim)", flexShrink: 0 }}>
                  {timeAgo(run.startedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Sub-components ── */

function HealthCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      background: "var(--panel)",
      border: "1px solid var(--line)",
      borderRadius: 10,
      padding: "14px 16px",
    }}>
      <div style={{ fontSize: 11, color: "var(--fg-dim)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function PlanBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{
      fontSize: 10,
      padding: "2px 8px",
      borderRadius: 4,
      background: `${color}18`,
      color,
      fontWeight: 500,
    }}>
      {label}: {value}
    </span>
  );
}
