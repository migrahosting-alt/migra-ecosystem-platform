"use client";

import { useEffect, useState, useCallback } from "react";
import { pilotApiUrl } from "@/lib/shared/pilot-api";
import { InboxSection } from "@/components/InboxSection";

interface InboxItem {
  id: string;
  type: "mission" | "drift" | "approval" | "notification";
  severity: "info" | "warn" | "critical";
  title: string;
  message: string;
  deepLink: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

interface InboxSummary {
  criticalCount: number;
  approvalsCount: number;
  proposedCount: number;
  failedMissionsCount: number;
  driftCriticalCount: number;
}

interface InboxSections {
  critical: InboxItem[];
  approvals: InboxItem[];
  proposed: InboxItem[];
  failed: InboxItem[];
  drift: InboxItem[];
}

interface InboxData {
  summary: InboxSummary;
  sections: InboxSections;
}

const POLL_INTERVAL = 15_000;

export default function InboxPage() {
  const [data, setData] = useState<InboxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch(pilotApiUrl("/api/inbox"));
      const json = await res.json();
      if (json.ok) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error ?? "Failed to load inbox");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInbox();
    const interval = setInterval(() => void fetchInbox(), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchInbox]);

  const handleAcknowledge = useCallback(
    async (id: string) => {
      try {
        await fetch(pilotApiUrl("/api/notifications/ack"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationId: id, operatorId: "console-operator" }),
        });
        void fetchInbox();
      } catch { /* silent */ }
    },
    [fetchInbox],
  );

  const handleExecuteNow = useCallback(
    async (id: string) => {
      try {
        await fetch(pilotApiUrl(`/api/mission/${id}/execute`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        void fetchInbox();
      } catch { /* silent */ }
    },
    [fetchInbox],
  );

  const handleRetry = useCallback(
    async (id: string) => {
      try {
        await fetch(pilotApiUrl(`/api/mission/${id}/retry`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        void fetchInbox();
      } catch { /* silent */ }
    },
    [fetchInbox],
  );

  const totalCount = data
    ? data.summary.criticalCount +
      data.summary.approvalsCount +
      data.summary.proposedCount +
      data.summary.failedMissionsCount +
      data.summary.driftCriticalCount
    : 0;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.25rem" }}>
        Inbox
      </h1>
      <p style={{ color: "#888", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        What needs your attention right now.
      </p>

      {loading && <p style={{ color: "#888" }}>Loading…</p>}
      {error && <p style={{ color: "#ef4444" }}>{error}</p>}

      {data && (
        <>
          {/* Summary bar */}
          <div
            style={{
              display: "flex",
              gap: "1rem",
              flexWrap: "wrap",
              marginBottom: "1.5rem",
              padding: "0.75rem 1rem",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <SummaryBadge label="Critical" count={data.summary.criticalCount} color="#ef4444" />
            <SummaryBadge label="Approvals" count={data.summary.approvalsCount} color="#f59e0b" />
            <SummaryBadge label="Proposed" count={data.summary.proposedCount} color="#3b82f6" />
            <SummaryBadge label="Failed" count={data.summary.failedMissionsCount} color="#f97316" />
            <SummaryBadge label="Drift" count={data.summary.driftCriticalCount} color="#8b5cf6" />
          </div>

          {totalCount === 0 && (
            <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#888" }}>
              <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✅</p>
              <p>All clear — nothing needs your attention.</p>
            </div>
          )}

          <InboxSection
            label="Critical"
            icon="🔴"
            count={data.summary.criticalCount}
            items={data.sections.critical}
            onAcknowledge={handleAcknowledge}
          />
          <InboxSection
            label="Approvals"
            icon="🛂"
            count={data.summary.approvalsCount}
            items={data.sections.approvals}
          />
          <InboxSection
            label="Proposed"
            icon="🧠"
            count={data.summary.proposedCount}
            items={data.sections.proposed}
            onExecuteNow={handleExecuteNow}
          />
          <InboxSection
            label="Failed"
            icon="❌"
            count={data.summary.failedMissionsCount}
            items={data.sections.failed}
            onRetry={handleRetry}
          />
          <InboxSection
            label="Drift"
            icon="🌊"
            count={data.summary.driftCriticalCount}
            items={data.sections.drift}
          />
        </>
      )}
    </div>
  );
}

function SummaryBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 22,
          height: 22,
          borderRadius: 12,
          fontSize: "0.75rem",
          fontWeight: 700,
          background: count > 0 ? color : "rgba(255,255,255,0.1)",
          color: count > 0 ? "#fff" : "#666",
        }}
      >
        {count}
      </span>
      <span style={{ fontSize: "0.8rem", color: "#aaa" }}>{label}</span>
    </div>
  );
}
