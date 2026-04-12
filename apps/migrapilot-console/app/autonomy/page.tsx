"use client";

import { useEffect, useMemo, useState } from "react";

import { pilotApiUrl } from "../../lib/shared/pilot-api";

type Env = "dev" | "stage" | "staging" | "prod" | "test";
type RunnerTarget = "auto" | "local" | "server";
type Classification = "internal" | "client";
type EnvState = "NORMAL" | "CAUTION" | "READ_ONLY";

interface AutonomyConfig {
  enabled: boolean;
  runnerPolicy: { allowServer: boolean; defaultRunnerTarget: RunnerTarget };
  environmentPolicy: { defaultEnv: Env; prodAllowed: boolean };
  budgets: {
    missionsPerHour: number;
    tier2PerDay: number;
    maxWritesPerMission: number;
    maxFailuresPerHour: number;
    maxAffectedTenantsPerMission: number;
  };
  confidenceGate: { minConfidenceToContinue: number; decayOnFailure: number; decayOnRetry: number };
}

interface AutonomyStatus {
  enabled: boolean;
  confidence: { score: number; lastUpdated: string; recentFailures: number; recentSuccesses: number };
  budgetsUsage: {
    missionsPerHour: { used: number; limit: number };
    tier2PerDay: { used: number; limit: number };
    failuresPerHour: { used: number; limit: number };
  };
  queueCounts: { queued: number; running: number; awaiting_approval: number; done: number; failed: number; skipped: number };
  lastRunTs?: string;
}

interface Finding {
  findingId: string;
  ts: string;
  source: "repo" | "inventory" | "health";
  severity: "info" | "warn" | "critical";
  title: string;
  details: string;
  classification?: Classification;
  tenantId?: string;
}

interface QueueItem {
  queueId: string;
  findingId: string;
  missionId?: string;
  templateId: string;
  status: "queued" | "running" | "awaiting_approval" | "done" | "failed" | "skipped";
  attempts: number;
  updatedAt: string;
  lastError?: { code: string; message: string };
  outputsRefs: Array<{ toolName: string; runId: string; jobId?: string; journalEntryId?: string }>;
}

interface MissionDef {
  id: string;
  name: string;
  description: string;
  schedule: string;
  intervalMs: number;
  prodAllowlisted: boolean;
  maxAutoTier: Record<string, number>;
  lastRun: { status: string; at: string; finishedAt: string | null } | null;
}

const STATE_COLOR: Record<EnvState, string> = {
  NORMAL: "var(--ok)",
  CAUTION: "var(--warn)",
  READ_ONLY: "var(--danger)",
};

function percent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

const ENVS = ["dev", "staging", "prod"] as const;

export default function AutonomyPage() {
  const [config, setConfig] = useState<AutonomyConfig | null>(null);
  const [status, setStatus] = useState<AutonomyStatus | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [envStates, setEnvStates] = useState<Record<string, { state: EnvState; reason: string | null }>>({});
  const [missions, setMissions] = useState<MissionDef[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [classificationFilter, setClassificationFilter] = useState<"all" | Classification>("all");
  const [selectedEnv, setSelectedEnv] = useState<string>("prod");

  async function refreshAll() {
    const [configRes, findingsRes, queueRes, statesRes, missionsRes] = await Promise.all([
      fetch(pilotApiUrl("/api/autonomy/config"), { cache: "no-store" }),
      fetch(pilotApiUrl(`/api/autonomy/findings?limit=200${classificationFilter === "all" ? "" : `&classification=${classificationFilter}`}`), { cache: "no-store" }),
      fetch(pilotApiUrl("/api/autonomy/queue?limit=200"), { cache: "no-store" }),
      fetch(pilotApiUrl("/api/autonomy/states"), { cache: "no-store" }),
      fetch(pilotApiUrl(`/api/autonomy/missions?env=${selectedEnv}`), { cache: "no-store" }),
    ]);

    const configPayload = (await configRes.json().catch(() => ({}))) as { ok: boolean; data?: { config: AutonomyConfig; status: AutonomyStatus } };
    const findingsPayload = (await findingsRes.json().catch(() => ({}))) as { ok: boolean; data?: { findings: Finding[] } };
    const queuePayload = (await queueRes.json().catch(() => ({}))) as { ok: boolean; data?: { queue: QueueItem[] } };
    const statesPayload = (await statesRes.json().catch(() => ({}))) as { ok: boolean; data?: { states: Record<string, { state: EnvState; reason: string | null }> } };
    const missionsPayload = (await missionsRes.json().catch(() => ({}))) as { ok: boolean; data?: { missions: MissionDef[] } };

    if (configPayload.ok && configPayload.data) { setConfig(configPayload.data.config); setStatus(configPayload.data.status); }
    if (findingsPayload.ok && findingsPayload.data) setFindings(findingsPayload.data.findings);
    if (queuePayload.ok && queuePayload.data) setQueue(queuePayload.data.queue);
    if (statesPayload.ok && statesPayload.data) setEnvStates(statesPayload.data.states);
    if (missionsPayload.ok && missionsPayload.data) setMissions(missionsPayload.data.missions);
  }

  async function updateConfig(nextConfig: AutonomyConfig) {
    const response = await fetch(pilotApiUrl("/api/autonomy/config"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: nextConfig }) });
    const payload = (await response.json()) as { ok: boolean; data?: { config: AutonomyConfig; status: AutonomyStatus }; error?: { message?: string } };
    if (!payload.ok || !payload.data) { setMessage(payload.error?.message ?? "Failed to update config"); return; }
    setConfig(payload.data.config);
    setStatus(payload.data.status);
    setMessage("Config saved");
  }

  async function toggle(enabled: boolean) {
    const endpoint = enabled ? "/api/autonomy/enable" : "/api/autonomy/disable";
    const response = await fetch(pilotApiUrl(endpoint), { method: "POST" });
    const payload = (await response.json()) as { ok: boolean; data?: AutonomyStatus; error?: { message?: string } };
    if (!payload.ok || !payload.data) { setMessage(payload.error?.message ?? "Failed"); return; }
    setStatus(payload.data);
    setConfig((c) => (c ? { ...c, enabled } : c));
    setMessage(enabled ? "Autonomy enabled" : "Autonomy disabled");
  }

  async function runOnce() {
    const response = await fetch(pilotApiUrl("/api/autonomy/runOnce"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const payload = (await response.json()) as { ok: boolean; data?: { insertedFindings: number; enqueuedItems: number; processedItems: number; status: AutonomyStatus }; error?: { message?: string } };
    if (!payload.ok || !payload.data) { setMessage(payload.error?.message ?? "runOnce failed"); return; }
    setStatus(payload.data.status);
    setMessage(`runOnce: findings ${payload.data.insertedFindings}, enqueued ${payload.data.enqueuedItems}, processed ${payload.data.processedItems}`);
    await refreshAll();
  }

  async function runTick(envFilter?: string) {
    const qs = envFilter ? `?env=${envFilter}` : "";
    const response = await fetch(pilotApiUrl(`/api/autonomy/tick${qs}`), { method: "POST" });
    const payload = (await response.json()) as { ok: boolean; data?: { results: Array<{ env: string; state: string; missionsRan: number }> }; error?: string };
    if (!payload.ok) { setMessage(payload.error ?? "Tick failed"); return; }
    const summary = payload.data?.results.map((r) => `${r.env}: ${r.missionsRan} run`).join(", ");
    setMessage(`Tick complete — ${summary ?? "0 missions"}`);
    await refreshAll();
  }

  async function setEnvStateReq(env: string, state: EnvState, reason?: string) {
    const response = await fetch(pilotApiUrl("/api/autonomy/set-state"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ env, state, reason }) });
    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!payload.ok) { setMessage(payload.error ?? "Failed to set state"); return; }
    setMessage(`${env} → ${state}`);
    await refreshAll();
  }

  async function unlockEnv(env: string) {
    const response = await fetch(pilotApiUrl("/api/autonomy/unlock"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ env, reason: "Manual operator unlock" }) });
    const payload = (await response.json()) as { ok: boolean; data?: { queued?: boolean; message?: string }; error?: string };
    if (!payload.ok) { setMessage(payload.error ?? "Unlock failed"); return; }
    setMessage(payload.data?.message ?? `${env} unlocked`);
    await refreshAll();
  }

  async function runMission(missionId: string, env: string) {
    const response = await fetch(pilotApiUrl("/api/autonomy/run-mission"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId, env }) });
    const payload = (await response.json()) as { ok: boolean; data?: { status: string; proofs: string[] }; error?: string };
    if (!payload.ok) { setMessage(payload.error ?? "Mission run failed"); return; }
    setMessage(`${missionId} on ${env}: ${payload.data?.status} (proofs: ${payload.data?.proofs.join(", ") || "none"})`);
    await refreshAll();
  }

  function exportReport() {
    const report = { status, config, findings, queue, envStates, missions, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autonomy-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { void refreshAll(); }, [classificationFilter, selectedEnv]);

  useEffect(() => {
    if (!status?.enabled) return;
    const timer = setInterval(() => { void runOnce(); }, 30000);
    return () => clearInterval(timer);
  }, [status?.enabled]);

  const confidencePercent = useMemo(() => Math.round((status?.confidence.score ?? 0) * 100), [status?.confidence.score]);

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Autonomy Dashboard</h2>
      <p className="small" style={{ color: "var(--muted)" }}>
        Autonomous Engineering OS — tick engine, per-env state machine, mission registry, confidence gating.
      </p>
      {message ? <div className="small" style={{ marginBottom: 10, padding: "6px 10px", background: "var(--surface-2, #1a1a1a)", borderRadius: 6 }}>{message}</div> : null}

      {/* ── Environment States ── */}
      <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600 }}>Environment States</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => void runTick()} style={{ fontSize: 11 }}>Run Tick (all)</button>
            <button onClick={() => void runTick(selectedEnv)} style={{ fontSize: 11 }}>Run Tick ({selectedEnv})</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {ENVS.map((env) => {
            const es = envStates[env];
            const state: EnvState = (es?.state as EnvState) ?? "NORMAL";
            return (
              <div key={env} className="panel" style={{ padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, textTransform: "uppercase", fontSize: 11, letterSpacing: 1 }}>{env}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: STATE_COLOR[state], padding: "2px 8px", border: `1px solid ${STATE_COLOR[state]}`, borderRadius: 10 }}>{state}</span>
                </div>
                {es?.reason ? <div className="small" style={{ color: "var(--muted)", marginTop: 4, fontSize: 10 }}>{es.reason}</div> : null}
                <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                  {state !== "NORMAL" && <button onClick={() => void setEnvStateReq(env, "NORMAL", "Operator reset")} style={{ fontSize: 10, padding: "2px 8px" }}>Set Normal</button>}
                  {state === "NORMAL" && <button onClick={() => void setEnvStateReq(env, "CAUTION", "Manual caution")} style={{ fontSize: 10, padding: "2px 8px" }}>Set Caution</button>}
                  {state === "READ_ONLY" && <button onClick={() => void unlockEnv(env)} style={{ fontSize: 10, padding: "2px 8px", color: "var(--warn)" }}>Unlock</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Mode + Confidence ── */}
      <div className="grid-2">
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600 }}>Mode</div>
            <span className="badge" style={{ color: status?.enabled ? "var(--ok)" : "var(--muted)" }}>{status?.enabled ? "enabled" : "disabled"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => void toggle(true)} disabled={status?.enabled}>Enable</button>
            <button onClick={() => void toggle(false)} disabled={!status?.enabled}>Disable</button>
            <button onClick={() => void runOnce()}>Run once</button>
            <button onClick={() => void refreshAll()}>Refresh</button>
          </div>
          <div className="small" style={{ marginTop: 8, color: "var(--muted)" }}>Last run: {status?.lastRunTs ? new Date(status.lastRunTs).toLocaleString() : "never"}</div>
        </div>

        <div className="panel" style={{ padding: 12 }}>
          <div style={{ fontWeight: 600 }}>Confidence</div>
          <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ width: `${confidencePercent}%`, background: confidencePercent > 70 ? "var(--ok)" : confidencePercent > 40 ? "var(--warn)" : "var(--danger)", height: 16 }} />
          </div>
          <div className="small" style={{ marginTop: 8 }}>score: {status?.confidence.score.toFixed(2) ?? "0.00"} ({confidencePercent}%)</div>
          <div className="small" style={{ color: "var(--muted)" }}>successes: {status?.confidence.recentSuccesses ?? 0} | failures: {status?.confidence.recentFailures ?? 0}</div>
        </div>
      </div>

      {/* ── Budgets ── */}
      {status ? (
        <div className="panel" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Budgets</div>
          {(["missionsPerHour", "tier2PerDay", "failuresPerHour"] as const).map((key) => {
            const entry = key === "missionsPerHour" ? status.budgetsUsage.missionsPerHour : key === "tier2PerDay" ? status.budgetsUsage.tier2PerDay : status.budgetsUsage.failuresPerHour;
            const p = percent(entry.used, entry.limit);
            return (
              <div key={key} style={{ marginBottom: 10 }}>
                <div className="small">{key}: {entry.used}/{entry.limit}</div>
                <div style={{ marginTop: 4, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ width: `${p}%`, height: 10, background: p < 70 ? "var(--ok)" : p < 90 ? "var(--warn)" : "var(--danger)" }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── Mission Registry ── */}
      <div className="panel" style={{ padding: 12, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600 }}>Mission Registry ({missions.length})</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label className="small" style={{ color: "var(--muted)" }}>env:</label>
            <select value={selectedEnv} onChange={(e) => setSelectedEnv(e.target.value)} style={{ fontSize: 11 }}>
              {ENVS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {missions.map((m) => (
            <div key={m.id} className="panel" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 11, color: "var(--muted)", minWidth: 24 }}>{m.id}</span>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  {m.prodAllowlisted ? <span style={{ fontSize: 10, padding: "1px 6px", border: "1px solid var(--ok)", borderRadius: 8, color: "var(--ok)" }}>prod-safe</span> : null}
                </div>
                <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>{m.description}</div>
                <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                  {m.schedule} | last:{" "}
                  {m.lastRun
                    ? <span style={{ color: m.lastRun.status === "OK" ? "var(--ok)" : "var(--danger)" }}>{m.lastRun.status} ({new Date(m.lastRun.at).toLocaleString()})</span>
                    : "never"}
                </div>
              </div>
              <button onClick={() => void runMission(m.id, selectedEnv)} style={{ fontSize: 11, padding: "4px 12px" }}>Run ({selectedEnv})</button>
            </div>
          ))}
          {missions.length === 0 ? <div className="small" style={{ color: "var(--muted)" }}>Mission registry not loaded — pilot-api connection required.</div> : null}
        </div>
      </div>

      {/* ── Config ── */}
      {config ? (
        <div className="panel" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Config</div>
          <div className="grid-2">
            <div>
              <label className="small">Default environment</label>
              <select value={config.environmentPolicy.defaultEnv} onChange={(e) => setConfig((c) => c ? { ...c, environmentPolicy: { ...c.environmentPolicy, defaultEnv: e.target.value as Env } } : c)}>
                {["dev", "stage", "staging", "prod", "test"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="small">Default runner</label>
              <select value={config.runnerPolicy.defaultRunnerTarget} onChange={(e) => setConfig((c) => c ? { ...c, runnerPolicy: { ...c.runnerPolicy, defaultRunnerTarget: e.target.value as RunnerTarget } } : c)}>
                {["auto", "local", "server"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={config.runnerPolicy.allowServer} onChange={(e) => setConfig((c) => c ? { ...c, runnerPolicy: { ...c.runnerPolicy, allowServer: e.target.checked } } : c)} />
              Allow server runner
            </label>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={config.environmentPolicy.prodAllowed} onChange={(e) => setConfig((c) => c ? { ...c, environmentPolicy: { ...c.environmentPolicy, prodAllowed: e.target.checked } } : c)} />
              Allow prod autonomy
            </label>
          </div>
          <div className="grid-2" style={{ marginTop: 10 }}>
            {(["missionsPerHour", "tier2PerDay", "maxWritesPerMission", "maxFailuresPerHour", "maxAffectedTenantsPerMission"] as const).map((key) => (
              <label key={key} className="small" style={{ display: "grid", gap: 6 }}>
                {key}
                <input type="number" value={config.budgets[key]} onChange={(e) => { const n = Math.max(0, Math.trunc(Number(e.target.value) || 0)); setConfig((c) => c ? { ...c, budgets: { ...c.budgets, [key]: n } } : c); }} />
              </label>
            ))}
            {(["minConfidenceToContinue", "decayOnFailure", "decayOnRetry"] as const).map((key) => (
              <label key={key} className="small" style={{ display: "grid", gap: 6 }}>
                {key}
                <input type="number" step="0.01" min="0" max="1" value={config.confidenceGate[key]} onChange={(e) => { const n = Math.max(0, Math.min(1, Number(e.target.value) || 0)); setConfig((c) => c ? { ...c, confidenceGate: { ...c.confidenceGate, [key]: n } } : c); }} />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => config && void updateConfig(config)}>Save config</button>
            <button onClick={exportReport}>Export report</button>
          </div>
        </div>
      ) : null}

      {/* ── Findings + Queue ── */}
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600 }}>Findings ({findings.length})</div>
            <select value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value as "all" | Classification)}>
              <option value="all">all</option>
              <option value="internal">internal</option>
              <option value="client">client</option>
            </select>
          </div>
          <div className="scroll" style={{ maxHeight: 420, marginTop: 10 }}>
            {findings.map((f) => (
              <div key={f.findingId} className="panel" style={{ padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{f.title}</span>
                  <span className="badge" style={{ color: f.severity === "critical" ? "var(--danger)" : f.severity === "warn" ? "var(--warn)" : "var(--muted)" }}>{f.severity}</span>
                </div>
                <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>{f.source} | {f.classification ?? "n/a"} | {new Date(f.ts).toLocaleString()}</div>
                <pre className="code" style={{ marginTop: 8 }}>{f.details}</pre>
              </div>
            ))}
            {findings.length === 0 ? <div className="small" style={{ color: "var(--muted)" }}>No findings.</div> : null}
          </div>
        </div>

        <div className="panel" style={{ padding: 12 }}>
          <div style={{ fontWeight: 600 }}>Queue ({queue.length})</div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
            queued {status?.queueCounts.queued ?? 0} | running {status?.queueCounts.running ?? 0} | awaiting approval {status?.queueCounts.awaiting_approval ?? 0}
          </div>
          <div className="scroll" style={{ maxHeight: 420, marginTop: 10 }}>
            {queue.map((item) => (
              <div key={item.queueId} className="panel" style={{ padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>{item.templateId}</span>
                  <span className="badge">{item.status}</span>
                </div>
                <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>queueId: {item.queueId}</div>
                <div className="small" style={{ color: "var(--muted)" }}>missionId: {item.missionId ?? "pending"} | attempts: {item.attempts}</div>
                {item.lastError ? <div className="small" style={{ marginTop: 6, color: "var(--danger)" }}>{item.lastError.code}: {item.lastError.message}</div> : null}
              </div>
            ))}
            {queue.length === 0 ? <div className="small" style={{ color: "var(--muted)" }}>Queue is empty.</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
