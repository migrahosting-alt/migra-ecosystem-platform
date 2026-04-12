"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type EnvState = "NORMAL" | "CAUTION" | "READ_ONLY";

interface BriefData {
  autonomyEnabled: boolean;
  confidence: number;
  lastRunTs: string | null;
  envStates: Record<string, { state: EnvState; reason: string | null }>;
  openIncidents: number;
  criticalIncidents: number;
}

const STATE_COLOR: Record<EnvState, string> = {
  NORMAL: "var(--ok)",
  CAUTION: "var(--warn)",
  READ_ONLY: "var(--danger)",
};

const ENVS = ["dev", "staging", "prod"] as const;

export function StatusBriefPanel({ onDismiss }: { onDismiss?: () => void }) {
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [configRes, statesRes, incidentsRes] = await Promise.all([
          fetch("/api/autonomy/config", { cache: "no-store" }).catch(() => null),
          fetch("/api/autonomy/states", { cache: "no-store" }).catch(() => null),
          fetch("/api/ops/incidents?status=OPEN&limit=100", { cache: "no-store" }).catch(() => null),
        ]);

        const configPayload = configRes ? await configRes.json().catch(() => ({})) : {};
        const statesPayload = statesRes ? await statesRes.json().catch(() => ({})) : {};
        const incidentsPayload = incidentsRes ? await incidentsRes.json().catch(() => ({})) : {};

        const status = (configPayload as { ok?: boolean; data?: { status?: { enabled?: boolean; confidence?: { score?: number }; lastRunTs?: string } } })?.data?.status;
        const envStates = (statesPayload as { ok?: boolean; data?: { states?: Record<string, { state: EnvState; reason: string | null }> } })?.data?.states ?? {};
        const incidents: Array<{ severity: string }> = (incidentsPayload as { ok?: boolean; data?: { incidents?: Array<{ severity: string }> } })?.data?.incidents ?? [];

        setData({
          autonomyEnabled: status?.enabled ?? false,
          confidence: status?.confidence?.score ?? 0,
          lastRunTs: status?.lastRunTs ?? null,
          envStates,
          openIncidents: incidents.length,
          criticalIncidents: incidents.filter((i) => i.severity === "CRITICAL").length,
        });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="panel fade-in" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12 }}>
          <span className="status-spinner" /> Loading system brief...
        </div>
      </div>
    );
  }

  if (!data) return null;

  const confidencePct = Math.round(data.confidence * 100);

  return (
    <div className="panel fade-in" style={{ padding: 16, marginBottom: 12, borderColor: "rgba(56,189,248,0.2)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent-glow)", border: "1px solid rgba(56,189,248,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>System Brief</div>
            <div style={{ fontSize: 10, color: "var(--fg-dim)", fontFamily: "var(--mono)" }}>
              {new Date().toLocaleString()}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="badge"
            style={{
              color: data.autonomyEnabled ? "var(--ok)" : "var(--muted)",
              border: `1px solid ${data.autonomyEnabled ? "var(--ok)" : "var(--line)"}`,
              padding: "2px 8px",
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            AUTONOMY {data.autonomyEnabled ? "ON" : "OFF"}
          </span>
          {onDismiss && (
            <button onClick={onDismiss} style={{ fontSize: 16, lineHeight: 1, padding: "2px 6px", background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)" }}>
              ×
            </button>
          )}
        </div>
      </div>

      {/* Env States row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
        {ENVS.map((env) => {
          const es = data.envStates[env];
          const state: EnvState = (es?.state as EnvState) ?? "NORMAL";
          return (
            <div key={env} style={{ padding: "8px 10px", border: `1px solid ${STATE_COLOR[state]}22`, borderRadius: 8, background: `${STATE_COLOR[state]}0a` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)" }}>{env}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: STATE_COLOR[state] }}>{state}</span>
              </div>
              {es?.reason && <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{es.reason}</div>}
            </div>
          );
        })}
      </div>

      {/* Metrics row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        {/* Confidence */}
        <div style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>Confidence</div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
            <div style={{ width: `${confidencePct}%`, height: 6, background: confidencePct > 70 ? "var(--ok)" : confidencePct > 40 ? "var(--warn)" : "var(--danger)" }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700 }}>{confidencePct}%</div>
        </div>

        {/* Open incidents */}
        <div style={{ padding: "8px 10px", border: `1px solid ${data.criticalIncidents > 0 ? "var(--danger)" : data.openIncidents > 0 ? "var(--warn)" : "var(--line)"}`, borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>Open Incidents</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: data.criticalIncidents > 0 ? "var(--danger)" : data.openIncidents > 0 ? "var(--warn)" : "var(--ok)" }}>
            {data.openIncidents}
          </div>
          {data.criticalIncidents > 0 && <div style={{ fontSize: 10, color: "var(--danger)" }}>{data.criticalIncidents} critical</div>}
        </div>

        {/* Last run */}
        <div style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>Last Tick</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
            {data.lastRunTs ? new Date(data.lastRunTs).toLocaleTimeString() : "—"}
          </div>
          {data.lastRunTs && <div style={{ fontSize: 9, color: "var(--muted)" }}>{new Date(data.lastRunTs).toLocaleDateString()}</div>}
        </div>
      </div>

      {/* Quick action links */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/incidents" style={{ fontSize: 11, padding: "5px 12px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text-secondary)", textDecoration: "none", transition: "all 180ms" }}>
          Incidents
        </Link>
        <Link href="/releases" style={{ fontSize: 11, padding: "5px 12px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text-secondary)", textDecoration: "none", transition: "all 180ms" }}>
          Releases
        </Link>
        <Link href="/drift" style={{ fontSize: 11, padding: "5px 12px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text-secondary)", textDecoration: "none", transition: "all 180ms" }}>
          Drift
        </Link>
        <Link href="/autonomy" style={{ fontSize: 11, padding: "5px 12px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text-secondary)", textDecoration: "none", transition: "all 180ms" }}>
          Autonomy
        </Link>
        <Link href="/approvals" style={{ fontSize: 11, padding: "5px 12px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text-secondary)", textDecoration: "none", transition: "all 180ms" }}>
          Approvals
        </Link>
      </div>
    </div>
  );
}
