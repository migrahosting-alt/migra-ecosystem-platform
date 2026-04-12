"use client";

import { useEffect, useState } from "react";
import { ReleasesTable, ReleaseDetail } from "../../components/ReleasesComponents";
import type { ReleaseRow, ReleaseStageRow, EnvName } from "../../lib/ui-contracts";

interface Release {
  id: string;
  runId: string;
  env: string;
  commit: string | null;
  branch: string | null;
  dirty: boolean;
  finalStatus: string;
  startedAt: string;
  finishedAt: string | null;
  stagesJson: unknown;
  createdAt: string;
}

interface ReleaseReport {
  id: string;
  runId: string;
  kind: string;
  href: string | null;
  summaryText: string | null;
  reportJson?: unknown;
  createdAt: string;
}

interface ReleaseDetailData extends Release {
  reports: ReleaseReport[];
}

interface ReleaseCheckData {
  phaseNumber: string;
  baseDir: string;
  blocked: boolean;
  strictPlaceholders: boolean;
  allowIncompleteDecision: boolean;
  errors: string[];
  warnings: string[];
  passes: string[];
  exitCode: number;
  soak?: {
    requiredDurationRaw?: string | null;
    requiredHours?: number | null;
    startTime?: string | null;
    startTimeRaw?: string | null;
    endTime?: string | null;
    endTimeRaw?: string | null;
    expectedEndTime?: string | null;
    elapsedHours?: string | null;
    remainingHours?: string | null;
    durationElapsed?: boolean;
  } | null;
  artifacts?: Record<string, string>;
  blockerDetails?: Array<{
    message: string;
    artifacts: string[];
  }>;
  nextActions?: string[];
  suggestedScripts?: Record<string, string>;
}

interface ReleaseCheckRunResult {
  runId: string;
  finalStatus: string;
  startedAt: string;
  finishedAt: string;
  governance: ReleaseCheckData;
}

interface ArtifactPreview {
  path: string;
  content: string;
  truncated?: boolean;
}

interface StoredGovernanceReport {
  reportId: string;
  createdAt: string;
  label: string;
  artifactPaths: string[];
  governance: ReleaseCheckData;
}

interface GovernanceComparison {
  blockerDelta: number;
  warningDelta: number;
  passDelta: number;
  introducedBlockers: string[];
  resolvedBlockers: string[];
  statusChanged: boolean;
}

function mapStatus(s: string): "OK" | "FAILED" | "PARTIAL" | "BLOCKED" {
  if (s === "OK") return "OK";
  if (s === "FAILED") return "FAILED";
  if (s === "BLOCKED") return "BLOCKED";
  return "PARTIAL"; // IN_PROGRESS and others
}

function calcDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "in progress";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function parseStages(stagesJson: unknown): ReleaseStageRow[] {
  if (!Array.isArray(stagesJson)) return [];
  return stagesJson.map((s) => {
    const stage = s as Record<string, unknown>;
    const ms = typeof stage.durationMs === "number" ? stage.durationMs : 0;
    const dur = ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
    return {
      name: typeof stage.name === "string" ? stage.name : String(stage.name ?? "unknown"),
      ok: Boolean(stage.ok),
      durationText: dur,
      code: typeof stage.exitCode === "number" ? stage.exitCode : null,
      timedOut: Boolean(stage.timedOut),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStoredGovernanceReport(detail: ReleaseDetailData | null): StoredGovernanceReport | null {
  if (!detail) {
    return null;
  }

  for (const report of [...detail.reports].reverse()) {
    if (!isRecord(report.reportJson)) {
      continue;
    }

    if (report.reportJson.type !== "release-check") {
      continue;
    }

    const governance = report.reportJson.governance;
    if (!isRecord(governance)) {
      continue;
    }

    return {
      reportId: report.id,
      createdAt: report.createdAt,
      label: typeof report.reportJson.label === "string" ? report.reportJson.label : "Stored release check",
      artifactPaths: Array.isArray(report.reportJson.artifactPaths)
        ? report.reportJson.artifactPaths.filter((item): item is string => typeof item === "string")
        : [],
      governance: governance as unknown as ReleaseCheckData,
    };
  }

  return null;
}

function compareGovernance(current: ReleaseCheckData, previous: ReleaseCheckData): GovernanceComparison {
  return {
    blockerDelta: current.errors.length - previous.errors.length,
    warningDelta: current.warnings.length - previous.warnings.length,
    passDelta: current.passes.length - previous.passes.length,
    introducedBlockers: current.errors.filter((item) => !previous.errors.includes(item)),
    resolvedBlockers: previous.errors.filter((item) => !current.errors.includes(item)),
    statusChanged: current.blocked !== previous.blocked,
  };
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [env, setEnv] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [governance, setGovernance] = useState<ReleaseCheckData | null>(null);
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [governanceError, setGovernanceError] = useState<string | null>(null);
  const [governanceRunMessage, setGovernanceRunMessage] = useState<string | null>(null);
  const [runningGovernanceCheck, setRunningGovernanceCheck] = useState(false);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreview | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReleaseDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previousDetail, setPreviousDetail] = useState<ReleaseDetailData | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = env !== "all" ? `?env=${env}&limit=50` : "?limit=50";
      const res = await fetch(`/api/ops/releases${qs}`, { cache: "no-store" });
      const payload = (await res.json()) as { ok: boolean; data?: { releases: Release[] }; error?: string };
      if (!payload.ok) { setError(payload.error ?? "Failed"); return; }
      setReleases(payload.data?.releases ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadGovernance() {
    setGovernanceLoading(true);
    setGovernanceError(null);
    try {
      const res = await fetch("/api/ops/release-check?phase=36", { cache: "no-store" });
      const payload = (await res.json()) as { ok: boolean; data?: ReleaseCheckData; error?: string; detail?: string };
      if (!payload.ok) {
        setGovernance(null);
        setGovernanceError(payload.error ?? payload.detail ?? "Failed to load release governance");
        return;
      }
      setGovernance(payload.data ?? null);
    } catch (e) {
      setGovernance(null);
      setGovernanceError(String(e));
    } finally {
      setGovernanceLoading(false);
    }
  }

  async function runGovernanceCheck() {
    setRunningGovernanceCheck(true);
    setGovernanceRunMessage(null);
    setGovernanceError(null);
    try {
      const res = await fetch("/api/ops/release-check/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase: "36" }),
      });
      const payload = (await res.json()) as { ok: boolean; data?: ReleaseCheckRunResult; error?: string };
      if (!payload.ok || !payload.data) {
        setGovernanceRunMessage(payload.error ?? "Failed to run strict release check");
        return;
      }

      setGovernance(payload.data.governance);
      setGovernanceRunMessage(`Strict release check recorded in ledger as ${payload.data.runId}.`);
      setSelectedRunId(payload.data.runId);
      await Promise.all([load(), loadDetail(payload.data.runId)]);
    } catch (e) {
      setGovernanceRunMessage(String(e));
    } finally {
      setRunningGovernanceCheck(false);
    }
  }

  async function openArtifactPreview(artifactPath: string) {
    setArtifactLoading(true);
    setArtifactError(null);
    try {
      const res = await fetch(`/api/ops/release-artifact?path=${encodeURIComponent(artifactPath)}`, { cache: "no-store" });
      const payload = (await res.json()) as { ok: boolean; data?: ArtifactPreview; error?: string };
      if (!payload.ok || !payload.data) {
        setArtifactPreview(null);
        setArtifactError(payload.error ?? "Failed to load artifact preview");
        return;
      }
      setArtifactPreview(payload.data);
    } catch (e) {
      setArtifactPreview(null);
      setArtifactError(String(e));
    } finally {
      setArtifactLoading(false);
    }
  }

  async function fetchReleaseDetail(runId: string): Promise<ReleaseDetailData | null> {
    const res = await fetch(`/api/ops/releases/${runId}`, { cache: "no-store" });
    const payload = (await res.json()) as { ok: boolean; data?: { release: ReleaseDetailData }; error?: string };
    return payload.ok ? payload.data?.release ?? null : null;
  }

  async function loadDetail(runId: string) {
    setDetailLoading(true);
    try {
      const selectedIndex = releases.findIndex((release) => release.runId === runId);
      const previousRunId = selectedIndex >= 0 && selectedIndex < releases.length - 1 ? releases[selectedIndex + 1]?.runId ?? null : null;
      const [currentDetail, previousReleaseDetail] = await Promise.all([
        fetchReleaseDetail(runId),
        previousRunId ? fetchReleaseDetail(previousRunId) : Promise.resolve(null),
      ]);
      setDetail(currentDetail);
      setPreviousDetail(previousReleaseDetail);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleSelectRow(runId: string) {
    if (selectedRunId === runId) {
      setSelectedRunId(null);
      setDetail(null);
      setPreviousDetail(null);
    } else {
      setSelectedRunId(runId);
      void loadDetail(runId);
    }
  }

  useEffect(() => {
    void load();
  }, [env]);

  useEffect(() => {
    void loadGovernance();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    void loadDetail(selectedRunId);
  }, [releases, selectedRunId]);

  const listEnv = (env === "all" ? "prod" : env) as EnvName;

  const rows: ReleaseRow[] = releases.map((r) => ({
    runId: r.runId,
    env: r.env as EnvName,
    status: mapStatus(r.finalStatus),
    timeText: new Date(r.startedAt).toLocaleString(),
    commitShort: r.commit?.slice(0, 8),
    durationText: calcDuration(r.startedAt, r.finishedAt),
    proofLinks: [],
  }));
  const blockingArtifacts = Array.from(new Set((governance?.blockerDetails ?? []).flatMap((item) => item.artifacts).filter(Boolean)));
  const keyPasses = (governance?.passes ?? []).slice(0, 6);
  const storedGovernance = asStoredGovernanceReport(detail);
  const previousStoredGovernance = asStoredGovernanceReport(previousDetail);
  const governanceComparison = storedGovernance && previousStoredGovernance
    ? compareGovernance(storedGovernance.governance, previousStoredGovernance.governance)
    : null;

  return (
    <section className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Release Ledger</h2>
          <p className="small" style={{ color: "var(--muted)", marginTop: -8 }}>
            Deployment history with stage timings and linked ops reports.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label className="small">env:</label>
          <select value={env} onChange={(e) => setEnv(e.target.value)}>
            <option value="all">all</option>
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </select>
          <button
            onClick={() => {
              void load();
              void loadGovernance();
            }}
            disabled={loading || governanceLoading || runningGovernanceCheck}
          >
            {loading || governanceLoading ? "..." : "Refresh"}
          </button>
          <button onClick={() => void runGovernanceCheck()} disabled={runningGovernanceCheck || governanceLoading}>
            {runningGovernanceCheck ? "Running…" : "Run strict check"}
          </button>
        </div>
      </div>

      {error ? <div className="small" style={{ color: "var(--danger)", marginBottom: 10 }}>{error}</div> : null}
      {governanceError ? <div className="small" style={{ color: "var(--danger)", marginBottom: 10 }}>{governanceError}</div> : null}
      {governanceRunMessage ? <div className="small" style={{ color: governance?.blocked ? "var(--warn)" : "var(--ok)", marginBottom: 10 }}>{governanceRunMessage}</div> : null}

      <div className="panel" style={{ padding: 14, marginTop: 12, border: governance?.blocked ? "1px solid rgba(239,68,68,0.35)" : "1px solid rgba(34,197,94,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--muted)" }}>
              Release Governance
            </div>
            <h3 style={{ margin: "6px 0 4px", fontSize: 18 }}>
              {governanceLoading ? "Checking release gate…" : governance?.blocked ? "Release Blocked" : "Release Ready"}
            </h3>
            <p className="small" style={{ color: "var(--muted)", margin: 0 }}>
              Strict Phase {governance?.phaseNumber ?? "36"} release enforcement surfaced in-product.
            </p>
          </div>
          <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
            <div className="small"><span style={{ color: "var(--muted)" }}>Mode:</span> strict placeholders {governance?.strictPlaceholders ? "on" : "off"}</div>
            <div className="small"><span style={{ color: "var(--muted)" }}>Base dir:</span> {governance?.baseDir ?? "docs/migrapilot/phase-36"}</div>
            <div className="small"><span style={{ color: "var(--muted)" }}>Checks:</span> {governance?.passes.length ?? 0} pass / {governance?.warnings.length ?? 0} warn / {governance?.errors.length ?? 0} fail</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 14 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Blocking Gates</div>
            {governance?.errors.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--danger)", fontSize: 12, display: "grid", gap: 6 }}>
                {governance.errors.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <div className="small" style={{ color: "var(--ok)" }}>No blocking gates.</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Warnings</div>
            {governance?.warnings.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--warn)", fontSize: 12, display: "grid", gap: 6 }}>
                {governance.warnings.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <div className="small" style={{ color: "var(--muted)" }}>No warnings.</div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 14 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Next Actions</div>
            {governance?.nextActions?.length ? (
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: "grid", gap: 6, color: "var(--text)" }}>
                {governance.nextActions.map((item) => <li key={item}>{item}</li>)}
              </ol>
            ) : (
              <div className="small" style={{ color: "var(--muted)" }}>No recommended actions.</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Soak Clock</div>
            {governance?.soak ? (
              <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                <div className="small"><span style={{ color: "var(--muted)" }}>Duration:</span> {governance.soak.requiredDurationRaw ?? `${governance.soak.requiredHours ?? "?"} hours`}</div>
                <div className="small"><span style={{ color: "var(--muted)" }}>Start:</span> {governance.soak.startTimeRaw ?? (governance.soak.startTime ? new Date(governance.soak.startTime).toLocaleString() : "—")}</div>
                <div className="small"><span style={{ color: "var(--muted)" }}>Deadline:</span> {governance.soak.expectedEndTime ? new Date(governance.soak.expectedEndTime).toLocaleString() : "—"}</div>
                <div className="small"><span style={{ color: "var(--muted)" }}>Elapsed:</span> {governance.soak.elapsedHours ? `${governance.soak.elapsedHours}h` : "—"}</div>
                <div className="small"><span style={{ color: "var(--muted)" }}>Remaining:</span> {governance.soak.durationElapsed ? "0.0h" : governance.soak.remainingHours ? `${governance.soak.remainingHours}h` : "—"}</div>
                <div className="small"><span style={{ color: "var(--muted)" }}>Window:</span> <span style={{ color: governance.soak.durationElapsed ? "var(--ok)" : "var(--warn)" }}>{governance.soak.durationElapsed ? "Elapsed" : "Active"}</span></div>
              </div>
            ) : (
              <div className="small" style={{ color: "var(--muted)" }}>No soak timing metadata available.</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Source Artifacts</div>
            {blockingArtifacts.length ? (
              <div style={{ display: "grid", gap: 6 }}>
                {blockingArtifacts.map((item) => (
                  <button
                    key={item}
                    onClick={() => void openArtifactPreview(item)}
                    style={{
                      textAlign: "left",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: 8,
                      background: "transparent",
                      color: "var(--text)",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : (
              <div className="small" style={{ color: "var(--muted)" }}>No blocking artifact focus areas.</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Artifact Preview</div>
          {artifactError ? <div className="small" style={{ color: "var(--danger)" }}>{artifactError}</div> : null}
          {artifactLoading ? <div className="small" style={{ color: "var(--muted)" }}>Loading artifact…</div> : null}
          {!artifactLoading && !artifactPreview ? (
            <div className="small" style={{ color: "var(--muted)" }}>Select a blocking artifact to inspect it directly from the release panel.</div>
          ) : null}
          {artifactPreview ? (
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>
                {artifactPreview.path}
              </div>
              <pre style={{ margin: 0, padding: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.45, maxHeight: 320, overflow: "auto" }}>
                {artifactPreview.content}
              </pre>
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 14 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Operator Commands</div>
            {governance?.suggestedScripts ? (
              <div style={{ display: "grid", gap: 6 }}>
                {Object.entries(governance.suggestedScripts).map(([label, command]) => (
                  <div key={label} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
                    <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11, wordBreak: "break-all" }}>{command}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="small" style={{ color: "var(--muted)" }}>No command suggestions.</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Healthy Checks</div>
            {keyPasses.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: "grid", gap: 6, color: "var(--ok)" }}>
                {keyPasses.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <div className="small" style={{ color: "var(--muted)" }}>No passing checks recorded yet.</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <ReleasesTable
          env={listEnv}
          rows={rows}
          onSelectRow={handleSelectRow}
          emptyText={loading ? "Loading…" : "No releases found. Deploy scripts will push records here via POST /api/ops/releases."}
        />
      </div>

      {/* Release Detail Panel */}
      {selectedRunId && (
        <div style={{ marginTop: 16 }}>
          {detailLoading ? (
            <div className="small" style={{ color: "var(--muted)", padding: 12 }}>Loading detail…</div>
          ) : detail ? (
            <ReleaseDetail
              env={detail.env as EnvName}
              runId={detail.runId}
              status={mapStatus(detail.finalStatus)}
              summaryLines={[
                `${detail.reports.length} stored report${detail.reports.length === 1 ? "" : "s"}`,
                storedGovernance ? `${storedGovernance.label} recorded ${new Date(storedGovernance.createdAt).toLocaleString()}` : "No stored governance report on this run.",
              ]}
              meta={{
                commit: detail.commit ?? undefined,
                branch: detail.branch ?? undefined,
                dirty: detail.dirty,
                startedAtText: new Date(detail.startedAt).toLocaleString(),
                finishedAtText: detail.finishedAt ? new Date(detail.finishedAt).toLocaleString() : undefined,
              }}
              stages={parseStages(detail.stagesJson)}
              reportLinks={[]}
              actions={[
                {
                  id: "close",
                  label: "Close",
                  tone: "secondary" as const,
                  onClick: () => { setSelectedRunId(null); setDetail(null); },
                },
              ]}
            />
          ) : null}

          {detail && storedGovernance ? (
            <div className="panel" style={{ padding: 14, marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Stored Governance Evidence</div>
                  <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                    {storedGovernance.label} captured {new Date(storedGovernance.createdAt).toLocaleString()}.
                  </div>
                </div>
                <div className="small" style={{ color: storedGovernance.governance.blocked ? "var(--warn)" : "var(--ok)", fontWeight: 700 }}>
                  {storedGovernance.governance.blocked ? "Blocked snapshot" : "Ready snapshot"}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Counts</div>
                  <div className="small"><span style={{ color: "var(--muted)" }}>Pass:</span> {storedGovernance.governance.passes.length}</div>
                  <div className="small"><span style={{ color: "var(--muted)" }}>Warn:</span> {storedGovernance.governance.warnings.length}</div>
                  <div className="small"><span style={{ color: "var(--muted)" }}>Fail:</span> {storedGovernance.governance.errors.length}</div>
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Stored Soak Clock</div>
                  <div className="small"><span style={{ color: "var(--muted)" }}>Deadline:</span> {storedGovernance.governance.soak?.expectedEndTime ? new Date(storedGovernance.governance.soak.expectedEndTime).toLocaleString() : "—"}</div>
                  <div className="small"><span style={{ color: "var(--muted)" }}>Remaining:</span> {storedGovernance.governance.soak?.durationElapsed ? "0.0h" : storedGovernance.governance.soak?.remainingHours ? `${storedGovernance.governance.soak.remainingHours}h` : "—"}</div>
                  <div className="small"><span style={{ color: "var(--muted)" }}>Window:</span> <span style={{ color: storedGovernance.governance.soak?.durationElapsed ? "var(--ok)" : "var(--warn)" }}>{storedGovernance.governance.soak?.durationElapsed ? "Elapsed" : "Active"}</span></div>
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Snapshot Blockers</div>
                  {storedGovernance.governance.errors.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18, color: "var(--danger)", fontSize: 12, display: "grid", gap: 6 }}>
                      {storedGovernance.governance.errors.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : (
                    <div className="small" style={{ color: "var(--ok)" }}>No blockers recorded for this run.</div>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Snapshot Actions</div>
                  {storedGovernance.governance.nextActions?.length ? (
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: "grid", gap: 6 }}>
                      {storedGovernance.governance.nextActions.map((item) => <li key={item}>{item}</li>)}
                    </ol>
                  ) : (
                    <div className="small" style={{ color: "var(--muted)" }}>No stored actions for this run.</div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Stored Artifact Focus</div>
                {storedGovernance.artifactPaths.length ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {storedGovernance.artifactPaths.map((item) => (
                      <button
                        key={item}
                        onClick={() => void openArtifactPreview(item)}
                        style={{
                          textAlign: "left",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          padding: "6px 8px",
                          background: "transparent",
                          color: "var(--text)",
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="small" style={{ color: "var(--muted)" }}>No stored artifact focus for this run.</div>
                )}
              </div>
            </div>
          ) : null}

          {detail && governanceComparison && previousDetail && previousStoredGovernance ? (
            <div className="panel" style={{ padding: 14, marginTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Previous Run Delta</div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
                Compared against {previousDetail.runId} from {new Date(previousDetail.startedAt).toLocaleString()}.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div className="panel" style={{ padding: 10 }}>
                  <div className="small" style={{ color: "var(--muted)" }}>Blockers</div>
                  <div style={{ fontWeight: 700, color: governanceComparison.blockerDelta <= 0 ? "var(--ok)" : "var(--warn)" }}>
                    {governanceComparison.blockerDelta > 0 ? "+" : ""}{governanceComparison.blockerDelta}
                  </div>
                </div>
                <div className="panel" style={{ padding: 10 }}>
                  <div className="small" style={{ color: "var(--muted)" }}>Warnings</div>
                  <div style={{ fontWeight: 700, color: governanceComparison.warningDelta <= 0 ? "var(--ok)" : "var(--warn)" }}>
                    {governanceComparison.warningDelta > 0 ? "+" : ""}{governanceComparison.warningDelta}
                  </div>
                </div>
                <div className="panel" style={{ padding: 10 }}>
                  <div className="small" style={{ color: "var(--muted)" }}>Passes</div>
                  <div style={{ fontWeight: 700, color: governanceComparison.passDelta >= 0 ? "var(--ok)" : "var(--warn)" }}>
                    {governanceComparison.passDelta > 0 ? "+" : ""}{governanceComparison.passDelta}
                  </div>
                </div>
                <div className="panel" style={{ padding: 10 }}>
                  <div className="small" style={{ color: "var(--muted)" }}>Gate State</div>
                  <div style={{ fontWeight: 700, color: governanceComparison.statusChanged ? "var(--warn)" : "var(--ok)" }}>
                    {governanceComparison.statusChanged ? "Changed" : "Unchanged"}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 14 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Introduced Blockers</div>
                  {governanceComparison.introducedBlockers.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18, color: "var(--danger)", fontSize: 12, display: "grid", gap: 6 }}>
                      {governanceComparison.introducedBlockers.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : (
                    <div className="small" style={{ color: "var(--ok)" }}>No new blockers relative to the previous run.</div>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Resolved Blockers</div>
                  {governanceComparison.resolvedBlockers.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ok)", fontSize: 12, display: "grid", gap: 6 }}>
                      {governanceComparison.resolvedBlockers.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : (
                    <div className="small" style={{ color: "var(--muted)" }}>No blockers were cleared relative to the previous run.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
