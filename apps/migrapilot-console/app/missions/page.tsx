"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { pilotApiUrl } from "../../lib/shared/pilot-api";

type MissionStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "canceled";

interface MissionSummary {
  missionId: string;
  createdAt: string;
  updatedAt: string;
  goal: string;
  environment: "dev" | "stage" | "staging" | "prod" | "test";
  status: MissionStatus;
  planner: "rule" | "llm";
  origin?: {
    source: "manual" | "autonomy";
    findingId?: string;
    templateId?: string;
  };
  completedTasks: number;
  totalTasks: number;
  pendingApproval?: {
    approvalId: string;
    taskId: string;
    toolName: string;
  };
  lastError?: string;
}

interface MissionListResponse {
  ok: boolean;
  data?: {
    missions: MissionSummary[];
  };
  error?: {
    message?: string;
  };
}

interface StartResponse {
  ok: boolean;
  data?: {
    missionId: string;
  };
  error?: {
    message?: string;
  };
}

export default function MissionsPage() {
  const router = useRouter();
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [goal, setGoal] = useState("Find overflow CSS issue and propose a patch");
  const [environment, setEnvironment] = useState<"dev" | "stage" | "staging" | "prod" | "test">("dev");
  const [runnerDefault, setRunnerDefault] = useState<"auto" | "local" | "server">("auto");
  const [allowServer, setAllowServer] = useState(false);
  const [maxTasks, setMaxTasks] = useState(2);

  async function loadMissions() {
    setLoading(true);
    try {
      const response = await fetch(pilotApiUrl("/api/mission/list?limit=150"), { cache: "no-store" });
      const payload = (await response.json()) as MissionListResponse;
      if (!payload.ok || !payload.data) {
        setMessage(payload.error?.message ?? "Failed to load missions");
        return;
      }
      setMissions(payload.data.missions);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMissions();
  }, []);

  async function startMission() {
    if (!goal.trim()) {
      setMessage("Mission goal is required.");
      return;
    }

    const response = await fetch(pilotApiUrl("/api/mission/start"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: goal.trim(),
        environment,
        operator: { operatorId: "bonex", role: "owner" },
        runnerPolicy: {
          default: runnerDefault,
          allowServer
        }
      })
    });
    const payload = (await response.json()) as StartResponse;
    if (!payload.ok || !payload.data) {
      setMessage(payload.error?.message ?? "Mission start failed");
      return;
    }

    setMessage(`Mission started: ${payload.data.missionId}`);
    await loadMissions();
    router.push(`/missions/${payload.data.missionId}`);
  }

  async function stepMission(missionId: string) {
    const response = await fetch(pilotApiUrl("/api/mission/step"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId, maxTasks })
    });
    const payload = (await response.json()) as { ok: boolean; error?: { message?: string } };
    setMessage(payload.ok ? `Stepped ${missionId}` : payload.error?.message ?? "Mission step failed");
    await loadMissions();
  }

  async function cancelMission(missionId: string) {
    const response = await fetch(pilotApiUrl("/api/mission/cancel"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId })
    });
    const payload = (await response.json()) as { ok: boolean; error?: { message?: string } };
    setMessage(payload.ok ? `Canceled ${missionId}` : payload.error?.message ?? "Mission cancel failed");
    await loadMissions();
  }

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Mission Dashboard</h2>
      <p className="small" style={{ color: "var(--muted)" }}>
        Start, step, cancel, and inspect orchestrated missions.
      </p>
      {message ? <div className="small">{message}</div> : null}

      <div className="panel" style={{ padding: 12, marginTop: 12 }}>
        <div className="small" style={{ marginBottom: 8, color: "var(--muted)" }}>
          Start mission
        </div>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} style={{ width: "100%", minHeight: 90 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <select value={environment} onChange={(event) => setEnvironment(event.target.value as typeof environment)}>
            <option value="dev">dev</option>
            <option value="stage">stage</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
            <option value="test">test</option>
          </select>
          <select value={runnerDefault} onChange={(event) => setRunnerDefault(event.target.value as typeof runnerDefault)}>
            <option value="auto">runner: auto</option>
            <option value="local">runner: local</option>
            <option value="server">runner: server</option>
          </select>
          <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={allowServer} onChange={(event) => setAllowServer(event.target.checked)} />
            allow server runner
          </label>
          <button onClick={() => void startMission()}>Start Mission</button>
        </div>
      </div>

      <div className="panel" style={{ padding: 12, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="small" style={{ color: "var(--muted)" }}>
            Missions ({missions.length}) {loading ? "- loading..." : ""}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label className="small">maxTasks</label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxTasks}
              onChange={(event) => setMaxTasks(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
              style={{ width: 80 }}
            />
            <button onClick={() => void loadMissions()}>Refresh</button>
          </div>
        </div>

        <div className="scroll" style={{ maxHeight: 540 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Mission</th>
                <th>Status</th>
                <th>Env</th>
                <th>Tasks</th>
                <th>Planner</th>
                <th>Origin</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {missions.map((mission) => (
                <tr key={mission.missionId}>
                  <td>
                    <div>{mission.missionId}</div>
                    <div className="small" style={{ color: "var(--muted)" }}>
                      {mission.goal.slice(0, 90)}
                    </div>
                  </td>
                  <td>
                    {mission.status}
                    {mission.pendingApproval ? (
                      <div className="small" style={{ color: "var(--warn)" }}>
                        approval: {mission.pendingApproval.approvalId}
                      </div>
                    ) : null}
                  </td>
                  <td>{mission.environment}</td>
                  <td>
                    {mission.completedTasks}/{mission.totalTasks}
                  </td>
                  <td>{mission.planner}</td>
                  <td>
                    <span className="badge">{mission.origin?.source ?? "manual"}</span>
                    {mission.origin?.source === "autonomy" ? (
                      <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                        {mission.origin.findingId ? `finding: ${mission.origin.findingId}` : "finding: n/a"}
                        <br />
                        {mission.origin.templateId ? `template: ${mission.origin.templateId}` : "template: n/a"}
                      </div>
                    ) : null}
                  </td>
                  <td>{new Date(mission.updatedAt).toLocaleString()}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Link href={`/missions/${mission.missionId}`}>
                      <button>Open</button>
                    </Link>
                    <button onClick={() => void stepMission(mission.missionId)}>Step</button>
                    <button onClick={() => void cancelMission(mission.missionId)}>Cancel</button>
                  </td>
                </tr>
              ))}
              {missions.length === 0 ? (
                <tr>
                      <td colSpan={8} className="small" style={{ color: "var(--muted)" }}>
                        No missions yet.
                      </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
