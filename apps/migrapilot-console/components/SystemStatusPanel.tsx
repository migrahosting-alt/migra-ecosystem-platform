"use client";

import { useEffect, useState } from "react";
import { pilotApiUrl } from "../lib/shared/pilot-api";

interface HealthData {
  status: string;
  uptime?: number;
  db?: string;
  version?: string;
}

interface SystemStatus {
  api: "online" | "degraded" | "offline";
  db: "connected" | "disconnected";
  uptime: string;
  version: string;
  lastDeploy: string;
  runCount: number;
  activeMissions: number;
  pendingApprovals: number;
  driftAlerts: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function SystemStatusPanel() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const [healthRes, readyRes, stateRes] = await Promise.all([
          fetch(pilotApiUrl("/health"), { cache: "no-store" }).catch(() => null),
          fetch(pilotApiUrl("/health/ready"), { cache: "no-store" }).catch(() => null),
          fetch("/api/state", { cache: "no-store" }).catch(() => null),
        ]);

        const health: HealthData = healthRes ? await healthRes.json() : {};
        const ready = readyRes ? await readyRes.json() : {};
        const state = stateRes ? await stateRes.json() : {};

        setStatus({
          api: healthRes?.ok ? "online" : "degraded",
          db: (ready as { db?: string })?.db === "connected" ? "connected" : "disconnected",
          uptime: health.uptime ? formatUptime(health.uptime) : "—",
          version: health.version ?? "—",
          lastDeploy: "—",
          runCount: (state as { data?: { runs?: unknown[] } })?.data?.runs?.length ?? 0,
          activeMissions: 0,
          pendingApprovals: 0,
          driftAlerts: 0,
        });
      } catch {
        setStatus({
          api: "offline",
          db: "disconnected",
          uptime: "—",
          version: "—",
          lastDeploy: "—",
          runCount: 0,
          activeMissions: 0,
          pendingApprovals: 0,
          driftAlerts: 0,
        });
      } finally {
        setLoading(false);
      }
    }
    void fetchStatus();
  }, []);

  if (loading) {
    return (
      <div className="status-panel fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 18, color: "var(--fg-dim)", fontSize: 12 }}>
          <span className="status-spinner" /> Connecting…
        </div>
      </div>
    );
  }

  if (!status) return null;

  const apiColor = status.api === "online" ? "var(--ok)" : status.api === "degraded" ? "var(--warn)" : "var(--danger)";
  const dbColor = status.db === "connected" ? "var(--ok)" : "var(--danger)";

  return (
    <div className="status-panel fade-in">
      <div className="status-panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="status-pulse" style={{ background: apiColor }} />
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>System Status</div>
        </div>
        <span className={status.api === "online" ? "badge-ok" : "badge-warn"} style={{ fontSize: 10 }}>
          {status.api === "online" ? "OPERATIONAL" : status.api.toUpperCase()}
        </span>
      </div>

      <div className="status-grid">
        <div className="status-cell">
          <div className="status-cell-label">API</div>
          <div className="status-cell-value" style={{ color: apiColor, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: apiColor, display: "inline-block" }} />
            {status.api}
          </div>
        </div>
        <div className="status-cell">
          <div className="status-cell-label">Database</div>
          <div className="status-cell-value" style={{ color: dbColor, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: dbColor, display: "inline-block" }} />
            {status.db}
          </div>
        </div>
        <div className="status-cell">
          <div className="status-cell-label">Uptime</div>
          <div className="status-cell-value">{status.uptime}</div>
        </div>
        <div className="status-cell">
          <div className="status-cell-label">Runs</div>
          <div className="status-cell-value">{status.runCount}</div>
        </div>
      </div>
    </div>
  );
}
