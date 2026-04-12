"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { pilotApiUrl } from "../lib/shared/pilot-api";
import { MissionModifyModal } from "./MissionModifyModal";

interface MissionAnalysis {
  detectedFrom: string;
  impact: {
    tenants: string[];
    domains: string[];
    pods: string[];
    services: string[];
  };
  riskLevel: "info" | "warn" | "critical";
  confidence: number;
  recommendation: string;
  proposedSteps: string[];
  correlationSummary?: string;
  findingId?: string;
  likelyCause?: string;
}

interface MissionRunnerPolicy {
  default: "auto" | "local" | "server";
  allowServer: boolean;
}

interface Props {
  missionId: string;
  goal: string;
  analysis?: MissionAnalysis | null;
  proposalExpiresAt?: string | null;
  runnerPolicy?: MissionRunnerPolicy;
  environment?: string;
  onConfirmed: () => void;
  onCancelled: () => void;
  onModified?: () => void;
}

function riskColor(level: "info" | "warn" | "critical"): string {
  if (level === "critical") return "var(--danger)";
  if (level === "warn") return "var(--warn)";
  return "var(--accent)";
}

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
}

function countdownColor(secs: number, totalSecs: number): string {
  if (totalSecs <= 0) return "var(--muted)";
  const ratio = secs / Math.max(totalSecs, 1);
  if (ratio > 0.5) return "var(--ok)";
  if (ratio > 0.2) return "var(--warn)";
  return "var(--danger)";
}

function formatSecs(secs: number): string {
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${secs}s`;
}

export function MissionProposalBanner({
  missionId,
  goal,
  analysis,
  proposalExpiresAt,
  runnerPolicy,
  environment,
  onConfirmed,
  onCancelled,
  onModified
}: Props) {
  const totalSecs = proposalExpiresAt ? secondsLeft(proposalExpiresAt) : 0;
  const hasAutoCountdown = Boolean(proposalExpiresAt) && totalSecs > 0;

  const [countdown, setCountdown] = useState<number>(totalSecs);
  const [initialTotal] = useState<number>(totalSecs);
  const [paused, setPaused] = useState(!hasAutoCountdown);
  const [autoFired, setAutoFired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModify, setShowModify] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const risk = analysis?.riskLevel ?? "info";
  const confidence = analysis?.confidence ?? 0.8;
  const color = riskColor(risk);
  const manualOnly = !hasAutoCountdown;

  useEffect(() => {
    if (!proposalExpiresAt || paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    intervalRef.current = setInterval(() => {
      const remaining = secondsLeft(proposalExpiresAt);
      setCountdown(remaining);
    }, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [proposalExpiresAt, paused]);

  const handleExecuteNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(pilotApiUrl("/api/mission/executeNow"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId })
      });
      const payload = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!payload.ok) {
        setError(payload.error?.message ?? "Execute failed");
        return;
      }
      onConfirmed();
    } finally {
      setBusy(false);
    }
  }, [missionId, onConfirmed]);

  useEffect(() => {
    if (countdown <= 0 && hasAutoCountdown && !paused && !autoFired) {
      setAutoFired(true);
      void handleExecuteNow();
    }
  }, [countdown, hasAutoCountdown, paused, autoFired, handleExecuteNow]);

  async function handleCancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(pilotApiUrl("/api/mission/cancel"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId })
      });
      const payload = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!payload.ok) {
        setError(payload.error?.message ?? "Cancel failed");
        return;
      }
      onCancelled();
    } finally {
      setBusy(false);
    }
  }

  function handlePause() {
    setPaused(true);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  function handleResume() {
    if (!proposalExpiresAt) return;
    const remaining = secondsLeft(proposalExpiresAt);
    if (remaining <= 0) return;
    setCountdown(remaining);
    setPaused(false);
  }

  function handleModifySaved(updatedMission: unknown) {
    setShowModify(false);
    const updated = updatedMission as { proposalExpiresAt?: string } | null;
    if (updated?.proposalExpiresAt) {
      const remaining = secondsLeft(updated.proposalExpiresAt);
      setCountdown(remaining);
      if (remaining > 0) setPaused(false);
    }
    onModified?.();
  }

  return (
    <>
      {showModify ? (
        <MissionModifyModal
          missionId={missionId}
          runnerPolicy={runnerPolicy}
          environment={environment}
          proposalExpiresAt={proposalExpiresAt}
          onSaved={handleModifySaved}
          onClose={() => setShowModify(false)}
        />
      ) : null}

      <div
        className="panel"
        onMouseEnter={paused || manualOnly ? undefined : handlePause}
        onFocus={paused || manualOnly ? undefined : handlePause}
        style={{ padding: 16, marginBottom: 14, borderLeft: `4px solid ${color}`, background: "var(--surface)" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 18 }}>🧠</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Proposal Ready</span>
          <span className="badge" style={{ color, borderColor: color }}>{risk.toUpperCase()}</span>
          <span className="badge">confidence {(confidence * 100).toFixed(0)}%</span>
          {analysis?.detectedFrom ? (
            <span className="badge" style={{ color: "var(--muted)", borderColor: "var(--muted)" }}>from: {analysis.detectedFrom}</span>
          ) : null}
          {manualOnly ? (
            <span className="badge" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>manual required</span>
          ) : null}
          {paused && !manualOnly ? (
            <span className="badge" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>⏸ paused</span>
          ) : null}
        </div>

        <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>{goal}</div>

        {analysis?.recommendation ? (
          <div className="panel" style={{ padding: 10, marginBottom: 10, borderLeft: `3px solid ${color}`, fontSize: 13 }}>
            {analysis.recommendation}
          </div>
        ) : null}

        {analysis?.impact &&
        (analysis.impact.tenants.length > 0 || analysis.impact.domains.length > 0 ||
          analysis.impact.pods.length > 0 || analysis.impact.services.length > 0) ? (
          <div className="panel" style={{ padding: 10, marginBottom: 10 }}>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Estimated Impact</div>
            {analysis.impact.tenants.length > 0 ? <div className="small">tenants: {analysis.impact.tenants.join(", ")}</div> : null}
            {analysis.impact.domains.length > 0 ? <div className="small">domains: {analysis.impact.domains.join(", ")}</div> : null}
            {analysis.impact.pods.length > 0 ? <div className="small">pods: {analysis.impact.pods.join(", ")}</div> : null}
            {analysis.impact.services.length > 0 ? <div className="small">services: {analysis.impact.services.join(", ")}</div> : null}
          </div>
        ) : null}

        {analysis?.proposedSteps && analysis.proposedSteps.length > 0 ? (
          <details className="panel" style={{ padding: 10, marginBottom: 10 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              Proposed Steps ({analysis.proposedSteps.length})
            </summary>
            <ol style={{ margin: "8px 0 0 18px", padding: 0 }}>
              {analysis.proposedSteps.map((step, i) => (
                <li key={i} className="small" style={{ marginBottom: 4 }}>{step}</li>
              ))}
            </ol>
          </details>
        ) : null}

        {analysis?.correlationSummary ? (
          <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
            Correlation: {analysis.correlationSummary}
          </div>
        ) : null}

        {/* Countdown progress bar */}
        {hasAutoCountdown && countdown > 0 && !autoFired ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, (countdown / Math.max(initialTotal, 1)) * 100)}%`,
                  background: countdownColor(countdown, initialTotal),
                  transition: "width 0.5s linear, background 0.5s"
                }} />
              </div>
              <span className="small" style={{ color: countdownColor(countdown, initialTotal), fontWeight: 600, minWidth: 52, textAlign: "right" }}>
                {paused ? "paused" : formatSecs(countdown)}
              </span>
            </div>
            {!paused ? (
              <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                Auto-executing in {formatSecs(countdown)} — hover to pause
              </div>
            ) : (
              <div className="small" style={{ color: "var(--warn)", marginTop: 4 }}>
                Countdown paused. Resume or execute manually below.
              </div>
            )}
          </div>
        ) : null}

        {manualOnly ? (
          <div className="small" style={{ color: "var(--warn)", marginBottom: 12, padding: "6px 10px", background: "rgba(200,150,0,0.07)", borderRadius: 4 }}>
            ⚠ Manual execution required — auto-countdown disabled (critical unresolved finding or low confidence).
          </div>
        ) : null}

        {error ? (
          <div className="small" style={{ color: "var(--danger)", marginBottom: 8 }}>{error}</div>
        ) : null}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => void handleExecuteNow()}
            disabled={busy}
            style={{ background: color, borderColor: color, color: "#fff", fontWeight: 600 }}
          >
            {busy ? "Working…" : "Execute Now"}
          </button>

          <button onClick={() => void handleCancel()} disabled={busy}>
            Cancel Mission
          </button>

          <button
            onClick={() => setShowModify(true)}
            disabled={busy}
            style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
          >
            ✏ Modify Plan
          </button>

          {paused && !manualOnly && countdown > 0 ? (
            <button
              onClick={handleResume}
              disabled={busy}
              style={{ color: "var(--ok)", borderColor: "var(--ok)" }}
            >
              ▶ Resume
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
