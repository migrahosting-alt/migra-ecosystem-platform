"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { MissionAnalysis, MissionLane, MissionRunRecord, MissionTask, MissionStatus } from "../../../lib/mission/types";
import { pilotApiUrl } from "../../../lib/shared/pilot-api";
import { MissionProposalBanner } from "../../../components/MissionProposalBanner";

type MissionEnvironment = "dev" | "stage" | "staging" | "prod" | "test";

interface MissionDetailPayload {
  missionId: string;
  status: MissionStatus;
  goal: string;
  createdAt: string;
  updatedAt: string;
  planner: "rule" | "llm";
  origin?: {
    source: "manual" | "autonomy";
    findingId?: string;
    templateId?: string;
  };
  runIdBase: string;
  completedTasks: number;
  pendingApproval?: {
    approvalId: string;
    missionId: string;
    taskId: string;
    toolName: string;
    riskSummary: string;
    requestedAt: string;
  };
  lastError?: string;
  tasks: MissionTask[];
  toolRuns: MissionRunRecord[];
  recentToolRuns: MissionRunRecord[];
  notes?: string[];
  analysis?: MissionAnalysis | null;
  proposedAt?: string | null;
  proposalExpiresAt?: string | null;
  runnerPolicy?: { default: "auto" | "local" | "server"; allowServer: boolean } | null;
  environment?: string | null;
  dryRun?: boolean | null;
}

interface MissionDetailResponse {
  ok: boolean;
  data?: MissionDetailPayload;
  error?: {
    code?: string;
    message?: string;
  };
}

interface MissionReport {
  missionId: string;
  status: MissionStatus;
  summary: string;
  tasks: Array<{
    taskId: string;
    lane: MissionLane;
    title: string;
    status: string;
    retries: number;
  }>;
  changedFiles: string[];
  verification: {
    qaPassed: boolean;
    checks: string[];
  };
  journalEntryIds: string[];
  nextActions: string[];
  markdown: string;
}

interface MissionReportResponse {
  ok: boolean;
  data?: MissionReport;
  error?: {
    message?: string;
  };
}

const laneOrder: MissionLane[] = ["code", "qa", "ops", "docs"];

function laneTasks(tasks: MissionTask[]) {
  return laneOrder.map((lane) => ({
    lane,
    items: tasks.filter((task) => task.lane === lane)
  }));
}

function taskBadgeColor(status: MissionTask["status"]): string {
  if (status === "done") return "var(--ok)";
  if (status === "failed") return "var(--danger)";
  if (status === "awaiting_approval") return "var(--warn)";
  if (status === "running") return "var(--accent)";
  return "var(--muted)";
}

export default function MissionDetailPage() {
  const params = useParams<{ missionId: string }>();
  const missionId = params.missionId;
  const [mission, setMission] = useState<MissionDetailPayload | null>(null);
  const [report, setReport] = useState<MissionReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [maxTasks, setMaxTasks] = useState(2);
  const [approvalCode, setApprovalCode] = useState("");

  const groupedTasks = useMemo(() => laneTasks(mission?.tasks ?? []), [mission?.tasks]);

  async function copy(value: string, label: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setMessage(`${label} copied`);
  }

  async function loadMission() {
    setLoading(true);
    try {
      const response = await fetch(pilotApiUrl(`/api/mission/${missionId}`), { cache: "no-store" });
      const payload = (await response.json()) as MissionDetailResponse;
      if (!payload.ok || !payload.data) {
        setMessage(payload.error?.message ?? "Failed to load mission");
        return;
      }
      setMission(payload.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadReport() {
    setReportLoading(true);
    try {
      const response = await fetch(pilotApiUrl(`/api/mission/${missionId}/report`), { cache: "no-store" });
      const payload = (await response.json()) as MissionReportResponse;
      if (!payload.ok || !payload.data) {
        setMessage(payload.error?.message ?? "Failed to load report");
        return;
      }
      setReport(payload.data);
    } finally {
      setReportLoading(false);
    }
  }

  async function stepMission() {
    const response = await fetch(pilotApiUrl("/api/mission/step"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId, maxTasks })
    });
    const payload = (await response.json()) as { ok: boolean; error?: { message?: string } };
    setMessage(payload.ok ? "Mission stepped" : payload.error?.message ?? "Mission step failed");
    await Promise.all([loadMission(), loadReport()]);
  }

  async function cancelMission() {
    const response = await fetch(pilotApiUrl("/api/mission/cancel"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId })
    });
    const payload = (await response.json()) as { ok: boolean; error?: { message?: string } };
    setMessage(payload.ok ? "Mission canceled" : payload.error?.message ?? "Mission cancel failed");
    await loadMission();
  }

  async function resolveApproval(action: "approve" | "reject") {
    if (!mission?.pendingApproval) {
      setMessage("No pending approval");
      return;
    }

    if (action === "approve" && !approvalCode.trim()) {
      setMessage("humanKeyTurnCode is required");
      return;
    }

    const response = await fetch(pilotApiUrl(`/api/approvals/${mission.pendingApproval.approvalId}`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        humanKeyTurnCode: action === "approve" ? approvalCode.trim() : undefined
      })
    });
    const payload = (await response.json()) as { ok: boolean; error?: { message?: string } };
    if (!payload.ok) {
      setMessage(payload.error?.message ?? "Approval action failed");
      return;
    }

    if (action === "approve") {
      await fetch(pilotApiUrl("/api/mission/step"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId, maxTasks })
      });
      setMessage("Approval applied and mission resumed");
    } else {
      setMessage("Approval rejected");
    }

    setApprovalCode("");
    await Promise.all([loadMission(), loadReport()]);
  }

  function downloadReportJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.missionId}.report.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (!missionId) return;
    void Promise.all([loadMission(), loadReport()]);
  }, [missionId]);

  return (
    <section className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Mission Detail</h2>
          <div className="small" style={{ color: "var(--muted)" }}>
            {missionId}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="small">maxTasks</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxTasks}
            onChange={(event) => setMaxTasks(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
            style={{ width: 80 }}
          />
          <button onClick={() => void stepMission()}>Step</button>
          <button onClick={() => void cancelMission()}>Cancel</button>
          <button onClick={() => void Promise.all([loadMission(), loadReport()])}>Refresh</button>
          <Link href="/missions">
            <button>Back</button>
          </Link>
        </div>
      </div>

      {message ? <div className="small" style={{ marginTop: 10 }}>{message}</div> : null}
      {loading && !mission ? <div className="small" style={{ marginTop: 10 }}>Loading mission...</div> : null}

      {mission ? (
        <>
          {mission.status === "proposed" ? (
            <MissionProposalBanner
              missionId={mission.missionId}
              goal={mission.goal}
              analysis={mission.analysis}
              proposalExpiresAt={mission.proposalExpiresAt}
              runnerPolicy={mission.runnerPolicy ?? undefined}
              environment={mission.environment ?? undefined}
              onConfirmed={() => void Promise.all([loadMission(), loadReport()])}
              onCancelled={() => void loadMission()}
              onModified={() => void loadMission()}
            />
          ) : null}

          <div className="grid-2" style={{ marginTop: 14 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600 }}>{mission.status}</div>
              <div className="small" style={{ marginTop: 6 }}>{mission.goal}</div>
              <div className="small" style={{ marginTop: 8, color: "var(--muted)" }}>
                planner: {mission.planner} | updated: {new Date(mission.updatedAt).toLocaleString()}
              </div>
              <div className="small" style={{ marginTop: 8, color: "var(--muted)" }}>
                origin: {mission.origin?.source ?? "manual"}
                {mission.origin?.source === "autonomy" ? (
                  <>
                    {" | "}finding: {mission.origin.findingId ?? "n/a"} | template: {mission.origin.templateId ?? "n/a"}
                  </>
                ) : null}
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                tasks: {mission.completedTasks}/{mission.tasks.length}
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                runIdBase: {mission.runIdBase}{" "}
                <button onClick={() => void copy(mission.runIdBase, "runIdBase")} style={{ marginLeft: 8 }}>
                  Copy
                </button>
              </div>
              {mission.lastError ? (
                <div className="small" style={{ marginTop: 8, color: "var(--danger)" }}>
                  lastError: {mission.lastError}
                </div>
              ) : null}
              {mission.notes?.length ? (
                <div className="small" style={{ marginTop: 10 }}>
                  Notes:
                  <pre className="code" style={{ marginTop: 6, maxHeight: 130 }}>{mission.notes.join("\n")}</pre>
                </div>
              ) : null}
            </div>

            <div className="panel" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600 }}>Tier 3 Approval</div>
              {mission.pendingApproval ? (
                <>
                  <div className="small" style={{ marginTop: 8 }}>
                    approvalId: {mission.pendingApproval.approvalId}
                  </div>
                  <div className="small">
                    task: {mission.pendingApproval.taskId} | tool: {mission.pendingApproval.toolName}
                  </div>
                  <div className="small" style={{ color: "var(--warn)", marginTop: 6 }}>
                    risk: {mission.pendingApproval.riskSummary}
                  </div>
                  <input
                    placeholder="humanKeyTurnCode"
                    value={approvalCode}
                    onChange={(event) => setApprovalCode(event.target.value)}
                    style={{ width: "100%", marginTop: 10 }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => void resolveApproval("approve")}>Approve + Resume</button>
                    <button onClick={() => void resolveApproval("reject")}>Reject</button>
                  </div>
                </>
              ) : (
                <div className="small" style={{ marginTop: 8, color: "var(--muted)" }}>
                  No pending approval.
                </div>
              )}
            </div>
          </div>

          <div className="panel" style={{ padding: 12, marginTop: 14 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
              Task graph by lane
            </div>
            <div className="grid-2">
              {groupedTasks.map((group) => (
                <div key={group.lane} className="panel" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>{group.lane.toUpperCase()} ({group.items.length})</div>
                  {group.items.length === 0 ? (
                    <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>No tasks.</div>
                  ) : (
                    group.items.map((task) => (
                      <div key={task.taskId} className="panel" style={{ padding: 8, marginTop: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div>{task.title}</div>
                          <span className="badge" style={{ color: taskBadgeColor(task.status), borderColor: taskBadgeColor(task.status) }}>
                            {task.status}
                          </span>
                        </div>
                        <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                          {task.taskId} | deps: {task.deps.length ? task.deps.join(", ") : "none"} | retries {task.retries}/{task.maxRetries}
                        </div>
                        <div className="small" style={{ marginTop: 4 }}>{task.intent}</div>
                        {task.lastError ? (
                          <div className="small" style={{ marginTop: 4, color: "var(--danger)" }}>
                            {task.lastError}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="panel" style={{ padding: 12, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="small" style={{ color: "var(--muted)" }}>
                Tool runs ({mission.toolRuns.length})
              </div>
              <Link href="/journal">
                <button>Open Journal</button>
              </Link>
            </div>
            <div className="scroll" style={{ maxHeight: 360 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>time</th>
                    <th>task</th>
                    <th>tool</th>
                    <th>runner/env</th>
                    <th>tier</th>
                    <th>refs</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {mission.toolRuns.map((run) => (
                    <tr key={run.id}>
                      <td>{new Date(run.createdAt).toLocaleTimeString()}</td>
                      <td>{run.taskId}</td>
                      <td>{run.toolName}</td>
                      <td>{run.runnerUsed} / {run.env as MissionEnvironment}</td>
                      <td>{run.baseTier} / {run.effectiveTier}</td>
                      <td>
                        {run.jobId ? (
                          <button onClick={() => void copy(run.jobId ?? "", "jobId")}>jobId</button>
                        ) : (
                          <span className="small" style={{ color: "var(--muted)" }}>job:none</span>
                        )}
                        {" "}
                        {run.journalEntryId ? (
                          <button onClick={() => void copy(run.journalEntryId ?? "", "journalEntryId")}>journal</button>
                        ) : (
                          <span className="small" style={{ color: "var(--muted)" }}>jrnl:none</span>
                        )}
                      </td>
                      <td style={{ color: run.ok ? "var(--ok)" : "var(--danger)" }}>
                        {run.ok ? "ok" : run.errorCode ?? "failed"}
                      </td>
                    </tr>
                  ))}
                  {mission.toolRuns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="small" style={{ color: "var(--muted)" }}>
                        No tool runs yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ padding: 12, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="small" style={{ color: "var(--muted)" }}>
                Mission report {reportLoading ? "- loading..." : ""}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => void loadReport()}>Refresh report</button>
                <button onClick={downloadReportJson} disabled={!report}>Download JSON</button>
              </div>
            </div>
            {report ? (
              <>
                <div className="small" style={{ marginBottom: 8 }}>
                  QA passed: <span style={{ color: report.verification.qaPassed ? "var(--ok)" : "var(--warn)" }}>
                    {String(report.verification.qaPassed)}
                  </span>{" "}
                  | changed files: {report.changedFiles.length} | journal links: {report.journalEntryIds.length}
                </div>
                <pre className="code">{report.markdown}</pre>
              </>
            ) : (
              <div className="small" style={{ color: "var(--muted)" }}>
                Report not loaded.
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
