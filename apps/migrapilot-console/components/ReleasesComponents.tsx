"use client";

import type { ReleasesTableProps, ReleaseDetailProps, ReleaseRow } from "../lib/ui-contracts";

const STATUS_COLOR: Record<string, string> = {
  OK:      "var(--ok)",
  FAILED:  "var(--danger)",
  PARTIAL: "var(--warn)",
  BLOCKED: "var(--warn)",
};

const STATUS_LABEL: Record<string, string> = {
  OK:      "Verified",
  FAILED:  "Failed",
  PARTIAL: "Needs Review",
  BLOCKED: "Approval Required",
};

const PROOF_ICONS: Record<string, string> = {
  "ops-report":     "📄",
  "ops-release":    "🚀",
  "activity-proof": "✅",
  "other":          "🔗",
};

/* ── ReleasesTable ── */
export function ReleasesTable({ rows, onSelectRow, emptyText }: ReleasesTableProps) {
  return (
    <div>
      {/* Column header */}
      <div style={{ display: "grid", gridTemplateColumns: "140px 60px 120px 120px 100px 80px 1fr", gap: 10, padding: "6px 10px", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid var(--line)" }}>
        <span>Time</span>
        <span>Env</span>
        <span>Status</span>
        <span>Run ID</span>
        <span>Commit</span>
        <span>Duration</span>
        <span>Proofs</span>
      </div>

      {rows.length === 0 ? (
        <div className="small" style={{ color: "var(--muted)", padding: "20px 10px", textAlign: "center" }}>
          {emptyText ?? "No releases found."}
        </div>
      ) : (
        rows.map((row) => <ReleasesRow key={row.runId} row={row} onSelect={onSelectRow} />)
      )}
    </div>
  );
}

function ReleasesRow({ row, onSelect }: { row: ReleaseRow; onSelect?: (id: string) => void }) {
  const color = STATUS_COLOR[row.status] ?? "var(--muted)";
  return (
    <div
      onClick={() => onSelect?.(row.runId)}
      style={{ display: "grid", gridTemplateColumns: "140px 60px 120px 120px 100px 80px 1fr", gap: 10, padding: "10px", borderBottom: "1px solid var(--line)", alignItems: "center", fontSize: 12, cursor: onSelect ? "pointer" : "default" }}
    >
      <span className="small" style={{ color: "var(--muted)" }}>{row.timeText}</span>
      <span style={{ fontSize: 11, padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 6, textAlign: "center" }}>{row.env}</span>
      <span style={{ fontWeight: 700, color, fontSize: 11 }}>{STATUS_LABEL[row.status] ?? row.status}</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }} title={row.runId}>
        {row.runId.slice(0, 12)}…
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)" }}>{row.commitShort ?? "—"}</span>
      <span className="small" style={{ color: row.status === "FAILED" ? "var(--danger)" : "var(--muted)" }}>{row.durationText ?? "—"}</span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {row.proofLinks?.map((l) => (
          <a key={l.href} href={l.href} onClick={(e) => e.stopPropagation()} style={{ fontSize: 10, padding: "1px 6px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text)", textDecoration: "none", display: "flex", alignItems: "center", gap: 3 }}>
            <span>{PROOF_ICONS[l.kind ?? "other"]}</span> {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ── ReleaseDetail ── */
export function ReleaseDetail({ env, runId, status, summaryLines, meta, stages, reportLinks, activityProofLinks, actions }: ReleaseDetailProps) {
  const statusColor = STATUS_COLOR[status] ?? "var(--muted)";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Summary */}
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase" }}>{env}</span>
            <span style={{ fontWeight: 700, color: statusColor }}>{STATUS_LABEL[status] ?? status}</span>
          </div>
          {actions && actions.length > 0 && (
            <div style={{ display: "flex", gap: 6 }}>
              {actions.map((a) => (
                <button key={a.id} onClick={a.onClick} disabled={a.disabled} style={{ fontSize: 11, padding: "4px 10px", color: a.tone === "danger" ? "var(--danger)" : undefined }}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Run ID: {runId}</div>
        {summaryLines?.map((l, i) => <div key={i} className="small" style={{ color: "var(--muted)" }}>{l}</div>)}
        {meta && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6, marginTop: 8 }}>
            {meta.branch && <div className="small"><span style={{ color: "var(--muted)" }}>Branch:</span> {meta.branch}</div>}
            {meta.commit && <div className="small" style={{ fontFamily: "var(--mono)" }}><span style={{ color: "var(--muted)" }}>Commit:</span> {meta.commit}</div>}
            {meta.dirty !== undefined && <div className="small"><span style={{ color: "var(--muted)" }}>Dirty:</span> <span style={{ color: meta.dirty ? "var(--warn)" : "var(--ok)" }}>{meta.dirty ? "yes" : "clean"}</span></div>}
            {meta.startedAtText && <div className="small"><span style={{ color: "var(--muted)" }}>Started:</span> {meta.startedAtText}</div>}
            {meta.finishedAtText && <div className="small"><span style={{ color: "var(--muted)" }}>Finished:</span> {meta.finishedAtText}</div>}
          </div>
        )}
      </div>

      {/* Stages */}
      {stages.length > 0 && (
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Stages</div>
          <div style={{ display: "grid", gap: 4 }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 80px", gap: 10, padding: "4px 8px", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid var(--line)" }}>
              <span>Stage</span>
              <span>Duration</span>
              <span>Exit</span>
              <span>Status</span>
            </div>
            {stages.map((stage, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 80px", gap: 10, padding: "6px 8px", borderBottom: "1px solid var(--line)", fontSize: 12, alignItems: "center" }}>
                <span>{stage.name}</span>
                <span className="small" style={{ color: "var(--muted)" }}>{stage.durationText}</span>
                <span className="small" style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>{stage.code ?? "—"}</span>
                <span style={{ fontWeight: 700, color: stage.timedOut ? "var(--warn)" : stage.ok ? "var(--ok)" : "var(--danger)", fontSize: 11 }}>
                  {stage.timedOut ? "timed out" : stage.ok ? "OK" : "FAILED"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proof links */}
      {((reportLinks && reportLinks.length > 0) || (activityProofLinks && activityProofLinks.length > 0)) && (
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Proof Links</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[...(reportLinks ?? []), ...(activityProofLinks ?? [])].map((l) => (
              <a key={l.href} href={l.href} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                <span>{PROOF_ICONS[l.kind ?? "other"]}</span> {l.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
