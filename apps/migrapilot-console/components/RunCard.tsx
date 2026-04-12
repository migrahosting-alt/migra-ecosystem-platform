"use client";

import { useState } from "react";

import type { TimelineRun } from "../lib/shared/types";

const statusConfig: Record<string, { badge: string; icon: string }> = {
  completed: { badge: "badge-ok", icon: "✓" },
  running: { badge: "badge-accent", icon: "⟳" },
  failed: { badge: "badge-danger", icon: "✗" },
  denied: { badge: "badge-warn", icon: "⊘" },
};

export function RunCard({ run }: { run: TimelineRun }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { badge, icon } = statusConfig[run.status] ?? { badge: "badge", icon: "•" };

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div
      className="fade-in"
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        background: "var(--bg-raised)",
        overflow: "hidden",
        transition: "border-color 160ms ease",
      }}
    >
      {/* Header row */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px",
        borderBottom: open ? "1px solid var(--line)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, flexShrink: 0,
            background: run.status === "completed"
              ? "rgba(52, 211, 153, 0.12)"
              : run.status === "failed"
              ? "rgba(248, 113, 113, 0.12)"
              : "rgba(56, 189, 248, 0.12)",
            color: run.status === "completed"
              ? "var(--ok)"
              : run.status === "failed"
              ? "var(--danger)"
              : "var(--accent)",
          }}>
            {icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
              {run.overlay.toolName}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {run.overlay.env} · {run.overlay.runnerType} · T{run.overlay.effectiveTier}
            </div>
          </div>
        </div>
        <span className={badge}>{run.status}</span>
      </div>

      {/* Metadata + actions */}
      <div style={{ padding: "8px 14px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)", padding: "2px 6px", background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
            {run.overlay.executionScope}
          </span>
          <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)", padding: "2px 6px", background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
            ABAC: {run.overlay.abacDecision}
          </span>
          {run.overlay.jobId && (
            <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)", padding: "2px 6px", background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
              job: {run.overlay.jobId.slice(0, 8)}…
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn-ghost btn-sm" onClick={() => void copy(run.id, "runId")} style={{ fontSize: 11 }}>
            📋 runId
          </button>
          {run.overlay.jobId && (
            <button className="btn-ghost btn-sm" onClick={() => void copy(run.overlay.jobId ?? "", "jobId")} style={{ fontSize: 11 }}>
              📋 jobId
            </button>
          )}
          {run.overlay.journalEntryId && (
            <button className="btn-ghost btn-sm" onClick={() => void copy(run.overlay.journalEntryId ?? "", "journalEntryId")} style={{ fontSize: 11 }}>
              📋 journal
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="btn-ghost btn-sm"
            onClick={() => setOpen((value) => !value)}
            style={{ fontSize: 11 }}
          >
            {open ? "▾ Collapse" : "▸ Details"}
          </button>
        </div>

        {copied && (
          <div className="fade-in" style={{
            marginTop: 6, fontSize: 11, color: "var(--ok)", fontFamily: "var(--mono)"
          }}>
            ✓ copied {copied}
          </div>
        )}
      </div>

      {/* Expandable detail */}
      {open && (
        <div className="fade-in" style={{
          padding: "0 14px 14px",
          display: "grid", gap: 10,
        }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5,
              color: "var(--muted)", marginBottom: 6
            }}>
              Input (sanitized)
            </div>
            <pre className="code" style={{ fontSize: 11 }}>
              {JSON.stringify(run.input, null, 2)}
            </pre>
          </div>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5,
              color: "var(--muted)", marginBottom: 6
            }}>
              Output
            </div>
            <pre className="code" style={{ fontSize: 11 }}>
              {JSON.stringify(run.output ?? { error: run.error }, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
