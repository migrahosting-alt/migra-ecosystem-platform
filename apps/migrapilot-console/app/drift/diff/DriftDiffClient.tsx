"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { pilotApiUrl } from "../../../lib/shared/pilot-api";

interface DriftCorrelationCandidate {
  kind: "mission" | "journal";
  missionId?: string;
  runId?: string;
  journalEntryId?: string;
  jobId?: string;
  toolName?: string;
  ts?: string;
  score: number;
  reasons: string[];
  impacted: {
    tenantIds?: string[];
    domains?: string[];
    podIds?: string[];
    serviceIds?: string[];
  };
}

interface DriftCorrelation {
  window: {
    fromTs: string;
    toTs: string;
  };
  candidates: DriftCorrelationCandidate[];
  best?: DriftCorrelationCandidate;
  summary: string;
}

interface DriftDiffPayload {
  diffId: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  ts: string;
  environment: "dev" | "stage" | "staging" | "prod" | "test";
  classification: "internal" | "client" | "all";
  diff: {
    added: {
      tenants: Array<Record<string, unknown>>;
      pods: Array<Record<string, unknown>>;
      domains: Array<Record<string, unknown>>;
      services: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    removed: {
      tenants: Array<Record<string, unknown>>;
      pods: Array<Record<string, unknown>>;
      domains: Array<Record<string, unknown>>;
      services: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    changed: {
      tenants: Array<Record<string, unknown>>;
      pods: Array<Record<string, unknown>>;
      domains: Array<Record<string, unknown>>;
      services: Array<Record<string, unknown>>;
    };
    summary: {
      totalAdded: number;
      totalRemoved: number;
      totalChanged: number;
      affectedTenants: string[];
      affectedClassification: {
        internal: number;
        client: number;
      };
      severity: "info" | "warn" | "critical";
    };
    correlation?: DriftCorrelation;
  };
}

function severityColor(value: "info" | "warn" | "critical"): string {
  if (value === "critical") return "var(--danger)";
  if (value === "warn") return "var(--warn)";
  return "var(--muted)";
}

function candidateLabel(candidate: DriftCorrelationCandidate): string {
  if (candidate.kind === "mission") {
    return `mission ${candidate.missionId ?? "unknown"}`;
  }
  return `journal ${candidate.journalEntryId ?? "unknown"}`;
}

async function copyValue(value?: string) {
  if (!value) {
    return;
  }
  await navigator.clipboard.writeText(value);
}

export default function DriftDiffClient() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const [diff, setDiff] = useState<DriftDiffPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missionMessage, setMissionMessage] = useState<string | null>(null);
  const [launchingMission, setLaunchingMission] = useState(false);

  async function load() {
    if (!from || !to) {
      setMessage("from and to snapshot ids are required");
      return;
    }

    const response = await fetch(pilotApiUrl(`/api/drift/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), {
      cache: "no-store"
    });
    const payload = (await response.json()) as {
      ok: boolean;
      data?: { diff: DriftDiffPayload };
      error?: { message?: string };
    };

    if (!payload.ok || !payload.data) {
      setMessage(payload.error?.message ?? "Failed to load diff");
      return;
    }

    setDiff(payload.data.diff);
    setMessage(null);
  }

  async function generateInvestigationMission() {
    if (!diff) {
      return;
    }

    setLaunchingMission(true);
    setMissionMessage(null);
    try {
      const response = await fetch(pilotApiUrl("/api/mission/start"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: `Investigate drift from ${diff.fromSnapshotId} to ${diff.toSnapshotId} and produce a read-only root-cause report with remediation options.`,
          context: {
            notes: `Triggered from drift diff ${diff.diffId}. Correlation summary: ${diff.diff.correlation?.summary ?? "none"}`
          },
          runnerPolicy: {
            default: "server",
            allowServer: true
          },
          environment: diff.environment,
          origin: {
            source: "manual",
            templateId: "TEMPLATE_DRIFT_INVESTIGATE"
          }
        })
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { missionId: string };
        error?: { message?: string };
      };

      if (!payload.ok || !payload.data) {
        setMissionMessage(payload.error?.message ?? "Failed to create investigation mission");
        return;
      }

      setMissionMessage(`Investigation mission created: ${payload.data.missionId}`);
    } finally {
      setLaunchingMission(false);
    }
  }

  useEffect(() => {
    void load();
  }, [from, to]);

  const sections: Array<{ label: string; value: unknown }> = diff
    ? [
        { label: "added.tenants", value: diff.diff.added.tenants },
        { label: "added.pods", value: diff.diff.added.pods },
        { label: "added.domains", value: diff.diff.added.domains },
        { label: "added.services", value: diff.diff.added.services },
        { label: "added.edges", value: diff.diff.added.edges },
        { label: "removed.tenants", value: diff.diff.removed.tenants },
        { label: "removed.pods", value: diff.diff.removed.pods },
        { label: "removed.domains", value: diff.diff.removed.domains },
        { label: "removed.services", value: diff.diff.removed.services },
        { label: "removed.edges", value: diff.diff.removed.edges },
        { label: "changed.tenants", value: diff.diff.changed.tenants },
        { label: "changed.pods", value: diff.diff.changed.pods },
        { label: "changed.domains", value: diff.diff.changed.domains },
        { label: "changed.services", value: diff.diff.changed.services }
      ]
    : [];

  const best = diff?.diff.correlation?.best;
  const otherCandidates = useMemo(() => {
    const all = diff?.diff.correlation?.candidates ?? [];
    if (!best) {
      return all.slice(0, 5);
    }
    return all.filter((candidate) => candidate !== best).slice(0, 5);
  }, [diff?.diff.correlation?.candidates, best]);

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Drift Diff</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <Link href="/drift">
          <button>Back</button>
        </Link>
      </div>
      {message ? <div className="small" style={{ marginTop: 10 }}>{message}</div> : null}

      {diff ? (
        <>
          <div className="panel" style={{ padding: 12, marginTop: 12 }}>
            <div className="small" style={{ color: "var(--muted)" }}>
              from {diff.fromSnapshotId} {"->"} to {diff.toSnapshotId}
            </div>
            <div style={{ marginTop: 8 }}>
              <span className="badge" style={{ color: severityColor(diff.diff.summary.severity), borderColor: severityColor(diff.diff.summary.severity) }}>
                severity: {diff.diff.summary.severity}
              </span>
            </div>
            <div className="small" style={{ marginTop: 8 }}>
              added {diff.diff.summary.totalAdded} | removed {diff.diff.summary.totalRemoved} | changed {diff.diff.summary.totalChanged}
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              affected tenants: {diff.diff.summary.affectedTenants.join(", ") || "none"}
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              affected classification internal {diff.diff.summary.affectedClassification.internal}, client {diff.diff.summary.affectedClassification.client}
            </div>
          </div>

          <div className="panel" style={{ padding: 12, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Likely Cause</h3>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
              {diff.diff.correlation?.summary ?? "No correlation data"}
            </div>

            {best ? (
              <div className="panel" style={{ padding: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="badge">{candidateLabel(best)}</span>
                  <span className="badge">confidence {(best.score * 100).toFixed(0)}%</span>
                  {best.missionId ? (
                    <Link href={`/missions/${best.missionId}`}>
                      <button>Open mission</button>
                    </Link>
                  ) : null}
                </div>
                <div className="small" style={{ marginTop: 8 }}>
                  tool: {best.toolName ?? "unknown"} | ts: {best.ts ?? "n/a"}
                </div>
                <div className="small" style={{ marginTop: 8 }}>
                  reasons: {best.reasons.join(", ") || "none"}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {best.runId ? <button onClick={() => void copyValue(best.runId)}>Copy runId</button> : null}
                  {best.jobId ? <button onClick={() => void copyValue(best.jobId)}>Copy jobId</button> : null}
                  {best.journalEntryId ? <button onClick={() => void copyValue(best.journalEntryId)}>Copy journalEntryId</button> : null}
                </div>
              </div>
            ) : (
              <div className="panel" style={{ padding: 10 }}>
                <div className="small">No strong cause found. This may be external/manual drift.</div>
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => void generateInvestigationMission()} disabled={launchingMission}>
                    {launchingMission ? "Creating mission..." : "Generate investigation mission"}
                  </button>
                </div>
                {missionMessage ? <div className="small" style={{ marginTop: 8 }}>{missionMessage}</div> : null}
              </div>
            )}

            <details className="panel" style={{ padding: 10, marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>Other candidates</summary>
              {otherCandidates.length === 0 ? (
                <div className="small" style={{ marginTop: 8 }}>No additional candidates.</div>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {otherCandidates.map((candidate) => (
                    <div key={`${candidate.kind}-${candidate.missionId ?? ""}-${candidate.journalEntryId ?? ""}-${candidate.runId ?? ""}`} className="panel" style={{ padding: 8 }}>
                      <div className="small">
                        {candidateLabel(candidate)} | {candidate.toolName ?? "unknown"} | {(candidate.score * 100).toFixed(0)}%
                      </div>
                      <div className="small" style={{ marginTop: 4 }}>
                        reasons: {candidate.reasons.join(", ") || "none"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </details>
          </div>

          {sections.map((section) => (
            <details key={section.label} className="panel" style={{ padding: 12, marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>{section.label}</summary>
              <pre className="code" style={{ marginTop: 10 }}>{JSON.stringify(section.value, null, 2)}</pre>
            </details>
          ))}
        </>
      ) : null}
    </section>
  );
}
