"use client";

/**
 * Enhanced Approval Modal — shows plan summary, blast radius, rollback hints.
 *
 * Replaces the inline approval card when WRITE/DANGER tools need approval.
 */

interface ApprovalModalProps {
  toolName: string;
  approvalId: string;
  expiresAt: string;
  argsJson?: Record<string, unknown>;
  blastRadius?: string;
  rollbackHint?: string;
  planSummary?: string;
  onApprove: () => void;
  onDeny: () => void;
  onClose?: () => void;
}

function redact(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(redact);
  const o: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>))
    o[k] = /(secret|token|password|apiKey|authorization)/i.test(k) ? "•••" : redact(val);
  return o;
}

function riskColor(toolName: string): string {
  if (/delete|purge|destroy|remove/i.test(toolName)) return "#f85149";
  if (/create|provision|deploy/i.test(toolName)) return "#d29922";
  return "#569cd6";
}

const S = {
  overlay: {
    position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12,
    width: "min(560px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column" as const,
    overflow: "hidden",
  },
  header: (color: string) => ({
    display: "flex", alignItems: "center", gap: 8,
    padding: "14px 18px", borderBottom: "1px solid var(--border)",
    borderTop: `3px solid ${color}`, flexShrink: 0,
  }),
  icon: { fontSize: 20 },
  titleBlock: { flex: 1 },
  title: { fontSize: 14, fontWeight: 700, color: "var(--fg-bright)" },
  subtitle: { fontSize: 11, color: "var(--fg-dim)", marginTop: 2 },
  closeBtn: {
    background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer",
    fontSize: 18, lineHeight: 1, padding: "2px 6px",
  },
  body: {
    flex: 1, overflowY: "auto" as const, padding: "14px 18px",
    display: "flex", flexDirection: "column" as const, gap: 12,
  },
  section: { fontSize: 12, color: "var(--fg)" },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const,
    letterSpacing: ".4px", color: "var(--fg-dim)", marginBottom: 4,
  },
  blastCard: {
    padding: "10px 14px", borderRadius: 6, fontSize: 12,
    background: "rgba(248,81,73,0.08)", border: "1px solid rgba(248,81,73,0.3)",
    color: "#f85149", lineHeight: "1.5",
  },
  rollbackCard: {
    padding: "10px 14px", borderRadius: 6, fontSize: 12,
    background: "rgba(86,156,214,0.08)", border: "1px solid rgba(86,156,214,0.3)",
    color: "#79c0ff", lineHeight: "1.5", fontFamily: "var(--mono)",
  },
  argsBlock: {
    padding: "8px 12px", borderRadius: 6, fontSize: 12,
    background: "var(--bg-input)", fontFamily: "var(--mono)",
    color: "var(--fg)", whiteSpace: "pre-wrap" as const, maxHeight: 180,
    overflowY: "auto" as const, lineHeight: "1.5",
  },
  footer: {
    display: "flex", gap: 8, padding: "12px 18px",
    borderTop: "1px solid var(--border)", flexShrink: 0,
    justifyContent: "flex-end",
  },
  denyBtn: {
    padding: "7px 20px", borderRadius: 6, border: "1px solid var(--border)",
    background: "var(--bg-active)", color: "var(--fg)", cursor: "pointer",
    fontSize: 12, fontWeight: 600,
  },
  approveBtn: {
    padding: "7px 20px", borderRadius: 6, border: "none",
    background: "var(--accent)", color: "#fff", cursor: "pointer",
    fontSize: 12, fontWeight: 600,
  },
  timer: { fontSize: 11, color: "var(--fg-dim)", textAlign: "center" as const, padding: "4px 0" },
};

export function ApprovalModal({
  toolName, approvalId, expiresAt, argsJson,
  blastRadius, rollbackHint, planSummary,
  onApprove, onDeny, onClose,
}: ApprovalModalProps) {
  const color = riskColor(toolName);
  const isDanger = /delete|purge|destroy|remove/i.test(toolName);
  const expiryStr = new Date(expiresAt).toLocaleString();

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header(color)}>
          <span style={S.icon}>{isDanger ? "🔴" : "⚠️"}</span>
          <div style={S.titleBlock}>
            <div style={S.title}>Approval Required — {toolName}</div>
            <div style={S.subtitle}>ID: {approvalId.slice(0, 16)}… · Expires {expiryStr}</div>
          </div>
          {onClose && <button style={S.closeBtn} onClick={onClose}>✕</button>}
        </div>

        {/* Body */}
        <div style={S.body}>
          {/* Plan Summary */}
          {planSummary && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Plan Summary</div>
              <div>{planSummary}</div>
            </div>
          )}

          {/* Blast Radius */}
          {blastRadius && (
            <div style={S.section}>
              <div style={S.sectionTitle}>💥 Blast Radius</div>
              <div style={S.blastCard}>{blastRadius}</div>
            </div>
          )}

          {/* Rollback Hint */}
          {rollbackHint && (
            <div style={S.section}>
              <div style={S.sectionTitle}>↩ Rollback</div>
              <div style={S.rollbackCard}>{rollbackHint}</div>
            </div>
          )}

          {/* Arguments */}
          {argsJson && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Arguments</div>
              <div style={S.argsBlock}>{JSON.stringify(redact(argsJson), null, 2)}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <button style={S.denyBtn} onClick={onDeny}>Deny</button>
          <button style={S.approveBtn} onClick={onApprove}>
            {isDanger ? "Approve DANGER" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
