"use client";

import { useEffect, useState, use } from "react";
import { Timeline } from "./Timeline";
import { ApprovalActions } from "./ApprovalActions";

/* ── Types ── */
interface EventRow {
  id: string;
  seq: number;
  type: string;
  level: string;
  message: string;
  payload: any;
  durationMs: number | null;
  spanId?: string | null;
  parentSpanId?: string | null;
  ts: string;
}

interface ArtifactRow {
  id: string;
  kind: string;
  label: string;
  content: string;
  sizeBytes: number;
  ts: string;
}

interface RunDetail {
  id: string;
  pilotRunId: string | null;
  conversationId: string;
  actorId: string;
  tenantId: string | null;
  model: string;
  tier: string;
  status: string;
  userMessage: string;
  assistantReply: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimateUsd: number;
  toolCallCount: number;
  iterationCount: number;
  escalationReason: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  metadata: any;
  startedAt: string;
  endedAt: string | null;
  trustScore: number;
  trustLabel: string | null;
  trustReasons: string[] | null;
  trustUpdatedAt: string | null;
  events: EventRow[];
  artifacts: ArtifactRow[];
}

const API = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://localhost:3377";

/* ── Helpers ── */
function fmtDate(s: string) { return new Date(s).toLocaleString(); }
function fmtDuration(ms: number | null) { return ms != null ? `${(ms / 1000).toFixed(2)}s` : "—"; }
function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function pretty(obj: any) { return JSON.stringify(obj, null, 2); }

function statusColor(s: string) {
  switch (s) {
    case "COMPLETED": return "var(--success)";
    case "FAILED": return "var(--danger)";
    case "RUNNING": return "var(--accent)";
    case "TIMED_OUT": return "var(--warning)";
    case "WAITING_APPROVAL": return "#ffb700";
    default: return "var(--fg-dim)";
  }
}

function trustColor(label: string | null, score: number) {
  if (label === "HIGH" || score >= 80) return "#4ec9b0";
  if (label === "MEDIUM" || score >= 50) return "#dcdcaa";
  return "#f14c4c";
}

function TrustScoreCard({ run }: { run: RunDetail }) {
  const [recomputing, setRecomputing] = useState(false);
  const [trust, setTrust] = useState<{ score: number; label: string | null; reasons: string[] | null }>({
    score: run.trustScore,
    label: run.trustLabel,
    reasons: run.trustReasons,
  });

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const res = await fetch(`${API}/api/ops/trust/${run.id}/recompute`, { method: "POST" });
      const j = await res.json();
      if (j.ok && j.data) {
        setTrust({ score: j.data.score, label: j.data.label, reasons: j.data.reasons });
      }
    } catch { /* ignore */ }
    setRecomputing(false);
  };

  const color = trustColor(trust.label, trust.score);

  return (
    <div style={{
      background: "var(--bg-sidebar)",
      border: `1px solid ${color}33`,
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-bright)" }}>Trust Score</div>
          <span style={{
            fontSize: 22,
            fontWeight: 700,
            fontFamily: "var(--mono)",
            color,
          }}>
            {trust.score}
          </span>
          <span style={{
            color,
            background: `${color}18`,
            padding: "2px 10px",
            borderRadius: "4px",
            fontSize: "11px",
            fontWeight: 600,
          }}>
            {trust.label ?? "—"}
          </span>
        </div>
        <button
          onClick={handleRecompute}
          disabled={recomputing}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 12px",
            color: "var(--fg-dim)",
            fontSize: 11,
            cursor: recomputing ? "wait" : "pointer",
          }}
        >
          {recomputing ? "Recomputing…" : "Recompute"}
        </button>
      </div>
      {trust.reasons && trust.reasons.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {trust.reasons.map((r, i) => (
            <div key={i} style={{
              fontSize: 11,
              fontFamily: "var(--mono)",
              color: r.startsWith("+0") ? "#f14c4c" : "var(--fg-dim)",
              padding: "2px 8px",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 4,
            }}>
              {r}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RunDetailPage({ params: paramsPromise }: { params: Promise<{ runId: string }> }) {
  const params = use(paramsPromise);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/pilot/journal/runs/${params.runId}`)
      .then(r => r.json())
      .then(j => {
        if (j.ok) setRun(j.run);
        else setError(j.error ?? "Run not found");
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.runId]);

  if (loading) return <div style={{ padding: 24, color: "var(--fg-dim)" }}>Loading run…</div>;
  if (error || !run) return <div style={{ padding: 24, color: "var(--danger)" }}>Error: {error ?? "Not found"}</div>;

  const snapshotEvent = run.events.find(e => e.type === "CONTEXT_SNAPSHOT");

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Back link + header ── */}
      <div style={{ marginBottom: 24 }}>
        <a href="/pilot/ops/runs" style={{ fontSize: 12, color: "var(--fg-dim)" }}>← Back to runs</a>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--fg-bright)", margin: "8px 0 0" }}>
          Run {run.id.slice(0, 16)}…
        </h1>
        <div style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: statusColor(run.status), fontWeight: 600 }}>{run.status}</span>
          <span>{run.tier}</span>
          <span>{run.model}</span>
          <span>{fmtDate(run.startedAt)}</span>
          {run.durationMs != null && <span>{fmtDuration(run.durationMs)}</span>}
        </div>
      </div>

      {/* ── Approval Gate Banner ── */}
      <ApprovalActions runId={run.id} status={run.status} />

      {/* ── Trust Score Card ── */}
      <TrustScoreCard run={run} />

      {/* ── Two-column: Snapshot + Summary ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Context Snapshot */}
        <div style={{
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-bright)", marginBottom: 8 }}>Context Snapshot</div>
          <pre style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 8,
            padding: 12,
            overflow: "auto",
            maxHeight: 420,
            margin: 0,
            color: "var(--fg)",
            whiteSpace: "pre-wrap",
          }}>
            {snapshotEvent?.payload ? pretty(snapshotEvent.payload) : "No snapshot recorded."}
          </pre>
        </div>

        {/* Run Summary */}
        <div style={{
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-bright)", marginBottom: 8 }}>Run Summary</div>
          {[
            { label: "Actor", value: run.actorId },
            { label: "Conversation", value: run.conversationId.slice(0, 16) + "…" },
            { label: "Tenant", value: run.tenantId ?? "—" },
            { label: "Tokens", value: `${fmtTokens(run.inputTokens)} in / ${fmtTokens(run.outputTokens)} out = ${fmtTokens(run.totalTokens)} total` },
            { label: "Tool Calls", value: run.toolCallCount },
            { label: "Iterations", value: run.iterationCount },
            { label: "Duration", value: fmtDuration(run.durationMs) },
            { label: "Escalation", value: run.escalationReason ?? "—" },
            { label: "Events", value: run.events.length },
            { label: "Artifacts", value: run.artifacts.length },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: "var(--fg-dim)" }}>{r.label}</span>
              <span style={{ color: "var(--fg-bright)" }}>{r.value}</span>
            </div>
          ))}
          {run.errorMessage && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(241,76,76,0.1)", border: "1px solid rgba(241,76,76,0.3)", borderRadius: 6, fontSize: 12, color: "var(--danger)" }}>
              {run.errorMessage}
            </div>
          )}
        </div>
      </div>

      {/* ── User Message ── */}
      <div style={{
        background: "var(--bg-sidebar)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-bright)", marginBottom: 8 }}>User Message</div>
        <div style={{ fontSize: 13, color: "var(--fg)", whiteSpace: "pre-wrap" }}>{run.userMessage}</div>
      </div>

      {/* ── Timeline (span-grouped) ── */}
      <div style={{
        background: "var(--bg-sidebar)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 24,
      }}>
        <div style={{
          padding: "10px 16px",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--fg-bright)",
          background: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid var(--border)",
        }}>
          Timeline ({run.events.length} events)
        </div>

        <Timeline events={run.events} />
      </div>

      {/* ── Artifacts ── */}
      {run.artifacts.length > 0 && (
        <div style={{
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--fg-bright)",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid var(--border)",
          }}>
            Artifacts ({run.artifacts.length})
          </div>

          {run.artifacts.map(a => (
            <div key={a.id} style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-bright)" }}>
                  [{a.kind}] {a.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                  {a.sizeBytes}B • {fmtDate(a.ts)}
                </span>
              </div>
              <pre style={{
                fontSize: 11,
                fontFamily: "var(--mono)",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 6,
                padding: 10,
                marginTop: 6,
                overflow: "auto",
                maxHeight: 300,
                color: "var(--fg-dim)",
                whiteSpace: "pre-wrap",
              }}>
                {a.content}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* ── Assistant Reply ── */}
      {run.assistantReply && (
        <div style={{
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
          marginTop: 24,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-bright)", marginBottom: 8 }}>Assistant Reply</div>
          <div style={{ fontSize: 13, color: "var(--fg)", whiteSpace: "pre-wrap" }}>{run.assistantReply}</div>
        </div>
      )}
    </div>
  );
}
