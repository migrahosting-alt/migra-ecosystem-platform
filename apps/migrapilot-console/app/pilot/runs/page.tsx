"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchRuns, fetchCommands, type V1RunSummary } from "@/lib/api/pilotV1";

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "var(--ok)",
  FAILED: "var(--danger)",
  DENIED: "var(--warn)",
  EXECUTING: "var(--accent)",
  VERIFYING: "var(--accent)",
  REQUESTED: "var(--fg-dim)",
  VALIDATING: "var(--fg-dim)",
};

const ALL_STATUSES = ["", "COMPLETED", "FAILED", "DENIED", "EXECUTING"];

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

export default function RunHistoryPage() {
  const [runs, setRuns] = useState<V1RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [commandNames, setCommandNames] = useState<string[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [commandFilter, setCommandFilter] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchRuns({
        limit,
        offset: page * limit,
        status: statusFilter || undefined,
        command: commandFilter || undefined,
      });
      setRuns(r.runs);
      setTotal(r.total);
    } catch {
      setRuns([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, commandFilter, page]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Load command names for filter dropdown
  useEffect(() => {
    fetchCommands()
      .then((c) => setCommandNames(c.commands.map((cmd) => cmd.command)))
      .catch(() => {});
  }, []);

  const totalPages = Math.ceil(total / limit);

  return (
    <section style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--text)" }}>Run History</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-dim)" }}>
            {total} total runs
          </p>
        </div>
        <Link href="/pilot" style={{ fontSize: 12, color: "var(--accent)" }}>
          ← Back to Pilot
        </Link>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--line)",
            color: "var(--text)",
            padding: "6px 12px",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={commandFilter}
          onChange={(e) => { setCommandFilter(e.target.value); setPage(0); }}
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--line)",
            color: "var(--text)",
            padding: "6px 12px",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <option value="">All commands</option>
          {commandNames.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <button
          onClick={() => void loadRuns()}
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            color: "var(--text-secondary)",
            padding: "6px 14px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Runs list */}
      <div style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        overflow: "hidden",
      }}>
        {/* Table header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 110px 90px 90px",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--line)",
          fontSize: 10,
          fontWeight: 600,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}>
          <span />
          <span>Command</span>
          <span>Status</span>
          <span>Duration</span>
          <span>When</span>
        </div>

        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--fg-dim)", fontSize: 13 }}>
            Loading…
          </div>
        ) : runs.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--fg-dim)", fontSize: 13 }}>
            No runs match the current filters.
          </div>
        ) : (
          runs.map((run) => (
            <Link
              key={run.id}
              href={`/pilot/runs/${run.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "32px 1fr 110px 90px 90px",
                gap: 8,
                padding: "10px 14px",
                borderBottom: "1px solid var(--line)",
                textDecoration: "none",
                transition: "background 120ms",
                alignItems: "center",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-surface)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: STATUS_COLOR[run.status] ?? "var(--fg-dim)",
              }} />
              <span style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {run.command}
              </span>
              <span style={{
                fontSize: 11,
                fontWeight: 500,
                color: STATUS_COLOR[run.status] ?? "var(--fg-dim)",
              }}>
                {run.status}
              </span>
              <span style={{ fontSize: 11, color: "var(--fg-dim)", fontFamily: "var(--mono)" }}>
                {formatMs(run.durationMs)}
              </span>
              <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                {timeAgo(run.startedAt)}
              </span>
            </Link>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--line)",
              color: page === 0 ? "var(--fg-dim)" : "var(--text)",
              padding: "6px 14px",
              borderRadius: 6,
              cursor: page === 0 ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: "var(--fg-dim)", alignSelf: "center" }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--line)",
              color: page >= totalPages - 1 ? "var(--fg-dim)" : "var(--text)",
              padding: "6px 14px",
              borderRadius: 6,
              cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
