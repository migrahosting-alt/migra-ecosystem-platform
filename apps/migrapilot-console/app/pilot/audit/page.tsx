"use client";

import { useEffect, useState, useCallback } from "react";
import {
  fetchAuditLog,
  type V1AuditEntry,
} from "@/lib/api/pilotV1";

const RESULT_COLOR: Record<string, string> = {
  success: "#4ade80",
  failure: "#f87171",
  denied: "#fbbf24",
};

const ACTOR_BADGE: Record<string, string> = {
  human: "#60a5fa",
  pilot: "#a78bfa",
  api: "#38bdf8",
  automation: "#fbbf24",
};

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - Date.parse(ts)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<V1AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const limit = 25;

  const loadData = useCallback(async () => {
    try {
      const res = await fetchAuditLog({ limit, offset: page * limit });
      setEntries(res.entries);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div style={{ padding: 32, color: "var(--fg-dim)" }}>
        Loading audit log...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, color: "var(--danger)" }}>
        Error: {error}
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        Audit Log
      </h1>
      <p style={{ color: "var(--fg-dim)", marginBottom: 24 }}>
        Unified control plane audit trail — every action recorded (§15 — Audit Engine)
      </p>

      <div style={{ fontSize: 13, color: "var(--fg-dim)", marginBottom: 16 }}>
        {total} total entries · Page {page + 1} of {Math.max(totalPages, 1)}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
                textAlign: "left",
              }}
            >
              <th style={{ padding: "8px 12px" }}>Time</th>
              <th style={{ padding: "8px 12px" }}>Actor</th>
              <th style={{ padding: "8px 12px" }}>Type</th>
              <th style={{ padding: "8px 12px" }}>Command</th>
              <th style={{ padding: "8px 12px" }}>Target</th>
              <th style={{ padding: "8px 12px" }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.id}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td
                  style={{
                    padding: "8px 12px",
                    color: "var(--fg-dim)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {timeAgo(e.timestamp)}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                >
                  {e.actorId.slice(0, 12)}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 10,
                      fontSize: 11,
                      background: ACTOR_BADGE[e.actorType] ?? "#6b7280",
                      color: "#000",
                      fontWeight: 600,
                    }}
                  >
                    {e.actorType}
                  </span>
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    fontWeight: 600,
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                >
                  {e.command}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    color: "var(--fg-dim)",
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                >
                  {e.target ?? "—"}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      color: RESULT_COLOR[e.result] ?? "var(--fg-dim)",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: RESULT_COLOR[e.result] ?? "#6b7280",
                      }}
                    />
                    {e.result}
                  </span>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: 24,
                    textAlign: "center",
                    color: "var(--fg-dim)",
                    fontStyle: "italic",
                  }}
                >
                  No audit entries yet. Execute commands to see entries here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: page === 0 ? "var(--fg-dim)" : "var(--fg)",
              cursor: page === 0 ? "default" : "pointer",
            }}
          >
            Previous
          </button>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: page >= totalPages - 1 ? "var(--fg-dim)" : "var(--fg)",
              cursor: page >= totalPages - 1 ? "default" : "pointer",
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
