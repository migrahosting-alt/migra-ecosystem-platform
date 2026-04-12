"use client";

import type { ApprovalCardProps, RiskTier } from "../lib/ui-contracts";

const TIER_COLOR: Record<RiskTier, string> = {
  T0: "var(--ok)",
  T1: "var(--warn)",
  T2: "var(--danger)",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING:   "var(--warn)",
  APPROVED:  "var(--ok)",
  EXECUTING: "#38bdf8",
  REJECTED:  "var(--danger)",
  EXPIRED:   "var(--muted)",
  EXECUTED:  "var(--ok)",
};

export function ApprovalCard({
  id,
  env,
  tier,
  status,
  title,
  why,
  impactSummary,
  expiresAtText,
  verificationPlanSummary,
  rollbackPlanSummary,
  payloadPreview,
  executionSummary,
  onApproveOnce,
  onApproveAlways,
  onReject,
  warningText,
}: ApprovalCardProps) {
  const tierColor = TIER_COLOR[tier];
  const statusColor = STATUS_COLOR[status] ?? "var(--muted)";
  const isPending = status === "PENDING";
  const isExecuting = status === "EXECUTING";

  return (
    <div
      className="panel fade-in"
      style={{ padding: 0, overflow: "hidden", borderLeft: `3px solid ${tierColor}` }}
    >
      <div style={{ padding: 14 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
              {env} · {id.slice(0, 12)} · expires {expiresAtText}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: tierColor, padding: "2px 8px", border: `1px solid ${tierColor}44`, borderRadius: 8 }}>
              {tier}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, padding: "2px 8px", border: `1px solid ${statusColor}44`, borderRadius: 8, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {isExecuting && (
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: statusColor, animation: "pulse 1.5s ease-in-out infinite" }} />
              )}
              {status}
            </span>
          </div>
        </div>

        {/* Why */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Why</div>
          <div className="small">{why}</div>
        </div>

        {/* Impact */}
        {impactSummary && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Impact</div>
            <div className="small">{impactSummary}</div>
          </div>
        )}

        {/* Prod warning */}
        {warningText && (
          <div style={{ padding: "6px 10px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, fontSize: 11, color: "var(--danger)", marginBottom: 10 }}>
            {warningText}
          </div>
        )}

        {/* Details grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          {verificationPlanSummary && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Verification Plan</div>
              <div className="small" style={{ color: "var(--muted)" }}>{verificationPlanSummary}</div>
            </div>
          )}
          {rollbackPlanSummary && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Rollback Plan</div>
              <div className="small" style={{ color: "var(--muted)" }}>{rollbackPlanSummary}</div>
            </div>
          )}
        </div>

        {/* Payload preview */}
        {payloadPreview && (
          <details style={{ marginBottom: 12 }}>
            <summary className="small" style={{ cursor: "pointer", color: "var(--muted)", userSelect: "none" }}>Payload</summary>
            <pre className="code" style={{ marginTop: 6, fontSize: 10, maxHeight: 120, overflow: "auto" }}>{payloadPreview}</pre>
          </details>
        )}

        {/* Last execution summary */}
        {executionSummary && (
          <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
            {executionSummary}
          </div>
        )}

        {/* "Approve Always" explanation */}
        {isPending && (
          <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
            <strong>Approve Always</strong> — approves this action in the same environment under the same scope. You can revoke always-approvals at any time.
          </div>
        )}

        {/* Executing hint */}
        {isExecuting && (
          <div className="small" style={{ color: "#38bdf8", marginBottom: 10 }}>
            This request is currently executing. Actions are temporarily disabled.
          </div>
        )}

        {/* Actions */}
        {(isPending || isExecuting) && (
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={isExecuting} onClick={onApproveOnce} style={{ fontSize: 12, padding: "6px 14px", background: isExecuting ? undefined : "rgba(52,211,153,0.08)", border: "1px solid var(--ok)", color: "var(--ok)", borderRadius: 6, opacity: isExecuting ? 0.4 : 1, cursor: isExecuting ? "not-allowed" : "pointer" }}>
              Approve Once
            </button>
            <button disabled={isExecuting} onClick={onApproveAlways} style={{ fontSize: 12, padding: "6px 14px", opacity: isExecuting ? 0.4 : 1, cursor: isExecuting ? "not-allowed" : "pointer" }}>
              Approve Always
            </button>
            <button disabled={isExecuting} onClick={onReject} style={{ fontSize: 12, padding: "6px 14px", color: "var(--danger)", borderColor: "var(--danger)", opacity: isExecuting ? 0.4 : 1, cursor: isExecuting ? "not-allowed" : "pointer" }}>
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
