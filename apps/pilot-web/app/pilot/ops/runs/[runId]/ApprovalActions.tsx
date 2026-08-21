"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://localhost:3377";

interface Approval {
  id: string;
  runId: string;
  reason: string;
  decision: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface ApprovalActionsProps {
  runId: string;
  status: string;
}

/**
 * Shows a banner when a run is WAITING_APPROVAL, allowing operators
 * to approve or deny the pending gate.  Once decided, shows the outcome.
 */
export function ApprovalActions({ runId, status }: ApprovalActionsProps) {
  const [pending, setPending] = useState<Approval | null>(null);
  const [decided, setDecided] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  // Auto-fetch pending approval when status is WAITING_APPROVAL
  if (status === "WAITING_APPROVAL" && !fetched) {
    setFetched(true);
    fetch(`${API}/api/pilot/execution-approvals/run/${runId}/pending`)
      .then(r => r.json())
      .then(j => { if (j.ok && j.pending) setPending(j.pending); })
      .catch(() => {});
  }

  async function handleDecision(decision: "approve" | "deny") {
    if (!pending) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/pilot/execution-approvals/${decision}/${pending.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const j = await r.json();
      if (j.ok) {
        setDecided(j.approval);
        setPending(null);
      } else {
        setError(j.error ?? "Unknown error");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Nothing to show if run isn't waiting and no decision was just made
  if (status !== "WAITING_APPROVAL" && !decided) return null;

  // Decision was just made — show outcome
  if (decided) {
    const approved = decided.decision === "APPROVED";
    return (
      <div style={{
        padding: "12px 16px",
        marginBottom: 16,
        borderRadius: 8,
        background: approved ? "rgba(0,200,83,0.08)" : "rgba(241,76,76,0.08)",
        border: `1px solid ${approved ? "rgba(0,200,83,0.3)" : "rgba(241,76,76,0.3)"}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}>
        <span style={{ fontSize: 18 }}>{approved ? "✅" : "🚫"}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-bright)" }}>
            {approved ? "Approved" : "Denied"} by {decided.decidedBy ?? "operator"}
          </div>
          <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 2 }}>
            {decided.reason}
          </div>
        </div>
      </div>
    );
  }

  // Waiting for approval — show action buttons
  return (
    <div style={{
      padding: "14px 16px",
      marginBottom: 16,
      borderRadius: 8,
      background: "rgba(255,183,0,0.08)",
      border: "1px solid rgba(255,183,0,0.3)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>⏸</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-bright)" }}>
            Awaiting Approval
          </div>
          {pending && (
            <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 2 }}>
              {pending.reason}
            </div>
          )}
        </div>
      </div>

      {pending && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => handleDecision("approve")}
            disabled={loading}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: "none",
              background: "#0078d4",
              color: "#fff",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "…" : "✅ Approve"}
          </button>
          <button
            onClick={() => handleDecision("deny")}
            disabled={loading}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: "1px solid rgba(241,76,76,0.5)",
              background: "transparent",
              color: "#f14c4c",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "…" : "🚫 Deny"}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>
          Error: {error}
        </div>
      )}
    </div>
  );
}
