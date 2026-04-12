"use client";

import type { IncidentsListProps, IncidentRow, Severity } from "../lib/ui-contracts";

const SEVERITY_COLOR: Record<Severity, string> = {
  INFO:     "var(--muted)",
  WARN:     "var(--warn)",
  ERROR:    "var(--danger)",
  CRITICAL: "var(--danger)",
};

const SEVERITY_BORDER: Record<Severity, string> = {
  INFO:     "var(--line)",
  WARN:     "rgba(251,191,36,0.4)",
  ERROR:    "rgba(248,113,113,0.4)",
  CRITICAL: "rgba(248,113,113,0.7)",
};

const STATUS_COLOR: Record<string, string> = {
  OPEN:     "var(--danger)",
  ACK:      "var(--warn)",
  RESOLVED: "var(--ok)",
};

const RUNBOOK_STEPS = [
  "Check current state: Health, Drift, Releases",
  "Review latest proofs linked below",
  "If production is read-only, request unlock approval",
  "Re-run canary smoke after mitigation",
];

export function IncidentsList({ rows, emptyText }: IncidentsListProps) {
  if (rows.length === 0) {
    return (
      <div className="small" style={{ color: "var(--muted)", padding: "20px 10px", textAlign: "center" }}>
        {emptyText ?? "No open incidents. Systems are stable."}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((row) => <IncidentCard key={row.id} row={row} />)}
    </div>
  );
}

function IncidentCard({ row }: { row: IncidentRow }) {
  const sev = row.severity;
  const borderColor = SEVERITY_BORDER[sev];
  const sevColor = SEVERITY_COLOR[sev];
  const statusColor = STATUS_COLOR[row.status] ?? "var(--muted)";

  const ack   = row.actions.find((a) => a.id === "ack");
  const res   = row.actions.find((a) => a.id === "resolve");
  const evi   = row.actions.find((a) => a.id === "viewEvidence");

  return (
    <div
      className="panel"
      style={{ padding: 0, overflow: "hidden", borderLeft: `3px solid ${borderColor}` }}
    >
      <div style={{ padding: 12 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{row.title}</div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
              {row.env}
              {row.dedupeKey ? ` · dedupe: ${row.dedupeKey.slice(0, 20)}` : ""}
              {row.firstSeenText ? ` · first seen: ${row.firstSeenText}` : ""}
              {row.runId ? ` · runId: ${row.runId.slice(0, 12)}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: sevColor, padding: "2px 8px", border: `1px solid ${borderColor}`, borderRadius: 8 }}>
              {sev}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, padding: "2px 8px", border: `1px solid ${statusColor}44`, borderRadius: 8 }}>
              {row.status}
            </span>
          </div>
        </div>

        {/* Evidence links */}
        {row.evidenceLinks && row.evidenceLinks.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {row.evidenceLinks.map((l) => (
              <a key={l.href} href={l.href} style={{ fontSize: 10, padding: "1px 8px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text)", textDecoration: "none" }}>
                {l.label}
              </a>
            ))}
          </div>
        )}

        {/* Runbook */}
        {row.status === "OPEN" && (
          <details style={{ marginTop: 10 }}>
            <summary className="small" style={{ cursor: "pointer", color: "var(--muted)", userSelect: "none" }}>
              Recommended next actions
            </summary>
            <ol style={{ marginTop: 6, paddingLeft: 20 }}>
              {RUNBOOK_STEPS.map((s, i) => (
                <li key={i} className="small" style={{ color: "var(--muted)", marginBottom: 2 }}>{s}</li>
              ))}
            </ol>
          </details>
        )}

        {/* Actions */}
        {(ack || res || evi) && (
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {ack && <button onClick={ack.onClick} disabled={ack.disabled} style={{ fontSize: 11, padding: "4px 10px" }}>Acknowledge</button>}
            {res && <button onClick={res.onClick} disabled={res.disabled} style={{ fontSize: 11, padding: "4px 10px" }}>Resolve</button>}
            {evi && <button onClick={evi.onClick} disabled={evi.disabled} style={{ fontSize: 11, padding: "4px 10px" }}>View Evidence</button>}
          </div>
        )}
      </div>
    </div>
  );
}
