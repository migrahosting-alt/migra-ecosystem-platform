"use client";

import { useEffect, useRef, useState } from "react";

import { pilotApiUrl } from "../lib/shared/pilot-api";

interface MissionRunnerPolicy {
  default: "auto" | "local" | "server";
  allowServer: boolean;
}

interface ModifyFields {
  runnerTarget: "auto" | "local" | "server";
  environment: "dev" | "staging" | "prod" | "test";
  dryRun: boolean;
  proposalWindowSecs: string;
  maxTasks: string;
}

interface Props {
  missionId: string;
  runnerPolicy?: MissionRunnerPolicy;
  environment?: string;
  proposalExpiresAt?: string | null;
  onSaved: (updatedMission: unknown) => void;
  onClose: () => void;
}

function GovernanceError({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "rgba(220,50,50,0.08)",
        border: "1px solid var(--danger)",
        borderRadius: 4,
        color: "var(--danger)",
        fontSize: 13,
        marginBottom: 10
      }}
    >
      ⚠ Governance: {message}
    </div>
  );
}

export function MissionModifyModal({ missionId, runnerPolicy, environment, proposalExpiresAt, onSaved, onClose }: Props) {
  const currentSecsLeft = proposalExpiresAt
    ? Math.max(0, Math.floor((Date.parse(proposalExpiresAt) - Date.now()) / 1000))
    : 0;

  const [fields, setFields] = useState<ModifyFields>({
    runnerTarget: (runnerPolicy?.default ?? "auto") as ModifyFields["runnerTarget"],
    environment: (["dev", "staging", "prod", "test"].includes(environment ?? "dev")
      ? environment
      : "dev") as ModifyFields["environment"],
    dryRun: false,
    proposalWindowSecs: String(currentSecsLeft > 0 ? currentSecsLeft : 120),
    maxTasks: ""
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [governanceError, setGovernanceError] = useState<string | null>(null);

  function handleOverlayClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.overlay === "true") onClose();
  }

  async function handleSave() {
    setError(null);
    setGovernanceError(null);
    setBusy(true);
    try {
      const windowSecs = fields.proposalWindowSecs.trim() ? parseInt(fields.proposalWindowSecs, 10) : undefined;
      const res = await fetch(pilotApiUrl("/api/mission/modify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionId,
          runnerPolicyOverride: { default: fields.runnerTarget, allowServer: fields.runnerTarget === "server" },
          environmentOverride: fields.environment,
          dryRun: fields.dryRun,
          proposalWindowSecs: windowSecs
        })
      });
      const payload = (await res.json()) as { ok: boolean; data?: { mission: unknown }; error?: { code?: string; message?: string } };
      if (!payload.ok) {
        if (payload.error?.code === "GOVERNANCE_VIOLATION") {
          setGovernanceError(payload.error.message ?? "Governance violation");
        } else {
          setError(payload.error?.message ?? "Modify failed");
        }
        return;
      }
      onSaved(payload.data?.mission);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-overlay="true"
      onClick={handleOverlayClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 24,
          width: 440,
          maxWidth: "95vw",
          maxHeight: "90vh",
          overflowY: "auto"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>✏ Modify Plan</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--muted)" }}>✕</button>
        </div>

        {governanceError ? <GovernanceError message={governanceError} /> : null}

        {/* Runner Target */}
        <fieldset style={{ border: "none", padding: 0, marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
            Runner Target
          </label>
          <select
            value={fields.runnerTarget}
            onChange={(e) => setFields((f) => ({ ...f, runnerTarget: e.target.value as ModifyFields["runnerTarget"] }))}
            style={{ width: "100%", padding: "6px 8px", fontSize: 13, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4 }}
          >
            <option value="auto">auto (recommended)</option>
            <option value="local">local</option>
            <option value="server">server (requires allowServer policy)</option>
          </select>
        </fieldset>

        {/* Environment */}
        <fieldset style={{ border: "none", padding: 0, marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
            Environment
          </label>
          <select
            value={fields.environment}
            onChange={(e) => setFields((f) => ({ ...f, environment: e.target.value as ModifyFields["environment"] }))}
            style={{ width: "100%", padding: "6px 8px", fontSize: 13, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4 }}
          >
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="test">test</option>
            <option value="prod">prod ⚠ governance applies</option>
          </select>
        </fieldset>

        {/* Proposal Window */}
        <fieldset style={{ border: "none", padding: 0, marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
            Proposal Window (seconds) — 0 = require manual execution
          </label>
          <input
            type="number"
            min={0}
            max={3600}
            value={fields.proposalWindowSecs}
            onChange={(e) => setFields((f) => ({ ...f, proposalWindowSecs: e.target.value }))}
            placeholder="120"
            style={{ width: "100%", padding: "6px 8px", fontSize: 13, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4 }}
          />
        </fieldset>

        {/* Dry Run */}
        <fieldset style={{ border: "none", padding: 0, marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={fields.dryRun}
              onChange={(e) => setFields((f) => ({ ...f, dryRun: e.target.checked }))}
            />
            Dry Run (observe-only, no writes)
          </label>
        </fieldset>

        {error ? (
          <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{error}</div>
        ) : null}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={busy}
            style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", fontWeight: 600 }}
          >
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
