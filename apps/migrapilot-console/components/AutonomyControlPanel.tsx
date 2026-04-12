"use client";

import type { AutonomyControlPanelProps, AutonomyRuntimeState } from "../lib/ui-contracts";

const STATE_COLOR: Record<AutonomyRuntimeState, string> = {
  NORMAL:    "var(--ok)",
  CAUTION:   "var(--warn)",
  READ_ONLY: "var(--danger)",
};

const STATE_BODY: Record<AutonomyRuntimeState, string> = {
  NORMAL:    "Autonomy is operating normally.",
  CAUTION:   "Autonomy is limited to safe operations until stability improves.",
  READ_ONLY: "Production changes are blocked. Approvals required to unlock.",
};

export function AutonomyControlPanel({
  env,
  autonomyEnabled,
  state,
  stateReason,
  onToggleAutonomy,
  onRunTickNow,
  onRequestUnlock,
  missionRows,
}: AutonomyControlPanelProps) {
  const stateColor = STATE_COLOR[state];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* ── Header row: env state + controls ── */}
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>{env}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: stateColor, padding: "2px 8px", border: `1px solid ${stateColor}`, borderRadius: 10 }}>
              {state}
            </span>
            <span className="badge" style={{ color: autonomyEnabled ? "var(--ok)" : "var(--muted)", border: `1px solid ${autonomyEnabled ? "var(--ok)" : "var(--line)"}`, padding: "1px 6px", borderRadius: 8, fontSize: 10 }}>
              {autonomyEnabled ? "ON" : "OFF"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onToggleAutonomy(!autonomyEnabled)} style={{ fontSize: 11, padding: "4px 10px" }}>
              {autonomyEnabled ? "Disable" : "Enable"}
            </button>
            <button onClick={onRunTickNow} style={{ fontSize: 11, padding: "4px 10px" }} title="Runs all due missions within blast radius limits.">
              Run Tick Now
            </button>
            {(state === "READ_ONLY" || env === "prod") && onRequestUnlock && (
              <button onClick={onRequestUnlock} style={{ fontSize: 11, padding: "4px 10px", color: "var(--warn)", borderColor: "var(--warn)" }} title="Creates an approval request to unlock production.">
                Unlock {env}
              </button>
            )}
          </div>
        </div>
        <div className="small" style={{ color: "var(--muted)" }}>{STATE_BODY[state]}</div>
        {stateReason && <div className="small" style={{ color: "var(--muted)", marginTop: 4, fontStyle: "italic" }}>{stateReason}</div>}
      </div>

      {/* ── Mission table ── */}
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Missions</div>
        {missionRows.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No missions configured yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 100px 120px 80px auto", gap: 10, padding: "4px 8px", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid var(--line)" }}>
              <span>ID</span>
              <span>Mission</span>
              <span>Schedule</span>
              <span>Last Run</span>
              <span>Next Due</span>
              <span>Actions</span>
            </div>
            {missionRows.map((row) => (
              <div key={row.id} style={{ display: "grid", gridTemplateColumns: "60px 1fr 100px 120px 80px auto", gap: 10, padding: "8px", borderBottom: "1px solid var(--line)", alignItems: "center", fontSize: 12 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{row.id}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{row.title}</div>
                  {row.badges && row.badges.length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                      {row.badges.map((b, i) => (
                        <span key={i} style={{ fontSize: 9, padding: "1px 5px", border: "1px solid var(--line)", borderRadius: 6, color: b.tone === "success" ? "var(--ok)" : b.tone === "warning" ? "var(--warn)" : b.tone === "danger" ? "var(--danger)" : "var(--muted)" }}>
                          {b.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="small" style={{ color: "var(--muted)" }}>{row.scheduleText}</span>
                <span className="small" style={{ color: "var(--muted)" }}>{row.lastRunText ?? "—"}</span>
                <span className="small" style={{ color: "var(--muted)" }}>{row.nextDueText ?? "—"}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {row.actions.map((a) => (
                    <button key={a.id} onClick={a.onClick} disabled={a.disabled} style={{ fontSize: 10, padding: "2px 8px" }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
