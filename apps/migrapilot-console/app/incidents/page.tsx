"use client";

import { useEffect, useState } from "react";
import { IncidentsList } from "../../components/IncidentsList";
import type { IncidentRow, EnvName } from "../../lib/ui-contracts";

type IncidentSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";
type IncidentStatus = "OPEN" | "ACK" | "RESOLVED";

interface Incident {
  id: string;
  env: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  dedupeKey: string | null;
  runId: string | null;
  missionId: string | null;
  evidence: Record<string, unknown>;
  createdAt: string;
  ackedAt: string | null;
  resolvedAt: string | null;
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [env, setEnv] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (env !== "all") params.set("env", env);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/ops/incidents?${params}`, { cache: "no-store" });
      const payload = (await res.json()) as { ok: boolean; data?: { incidents: Incident[] }; error?: string };
      if (!payload.ok) { setMessage(payload.error ?? "Failed"); return; }
      setIncidents(payload.data?.incidents ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function ack(id: string) {
    const res = await fetch("/api/ops/incidents/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const payload = (await res.json()) as { ok: boolean; error?: string };
    if (!payload.ok) { setMessage(payload.error ?? "Failed"); return; }
    setMessage("Incident acknowledged");
    await load();
  }

  async function resolve(id: string) {
    const res = await fetch("/api/ops/incidents/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const payload = (await res.json()) as { ok: boolean; error?: string };
    if (!payload.ok) { setMessage(payload.error ?? "Failed"); return; }
    setMessage("Incident resolved");
    await load();
  }

  useEffect(() => { void load(); }, [env, statusFilter]);

  const openCount = incidents.filter((i) => i.status === "OPEN").length;
  const criticalCount = incidents.filter((i) => i.severity === "CRITICAL" && i.status === "OPEN").length;

  const listEnv = (env === "all" ? "prod" : env) as EnvName;

  const rows: IncidentRow[] = incidents.map((inc) => ({
    id: inc.id,
    env: inc.env as EnvName,
    severity: inc.severity,
    status: inc.status,
    title: inc.title,
    firstSeenText: new Date(inc.createdAt).toLocaleString(),
    dedupeKey: inc.dedupeKey ?? undefined,
    runId: inc.runId ?? undefined,
    evidenceLinks: Object.keys(inc.evidence).length > 0
      ? [{ label: "Evidence", href: "#" }]
      : undefined,
    actions: [
      {
        id: "ack" as const,
        label: "Acknowledge",
        onClick: () => { void ack(inc.id); },
        disabled: inc.status !== "OPEN",
      },
      {
        id: "resolve" as const,
        label: "Resolve",
        onClick: () => { void resolve(inc.id); },
        disabled: inc.status === "RESOLVED",
      },
    ],
  }));

  return (
    <section className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Incidents</h2>
          {openCount > 0 ? (
            <div className="small" style={{ marginTop: -8, marginBottom: 8 }}>
              <span style={{ color: "var(--danger)", fontWeight: 700 }}>{openCount} open</span>
              {criticalCount > 0 ? <span style={{ color: "var(--danger)", marginLeft: 8 }}>{criticalCount} critical</span> : null}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={env} onChange={(e) => setEnv(e.target.value)}>
            <option value="all">all envs</option>
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="OPEN">open</option>
            <option value="ACK">acked</option>
            <option value="RESOLVED">resolved</option>
            <option value="all">all</option>
          </select>
          <button onClick={() => void load()} disabled={loading}>{loading ? "..." : "Refresh"}</button>
        </div>
      </div>

      {message ? <div className="small" style={{ marginBottom: 10, padding: "6px 10px", background: "var(--surface-2)", borderRadius: 6 }}>{message}</div> : null}

      <div style={{ marginTop: 12 }}>
        <IncidentsList env={listEnv} rows={rows} emptyText={loading ? "Loading…" : "No incidents matching current filters."} />
      </div>
    </section>
  );
}
