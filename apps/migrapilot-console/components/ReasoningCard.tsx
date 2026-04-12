"use client";

/**
 * ReasoningCard: Plan & Proof trust UI.
 * Shows intent, mode, step-by-step plan with risk tiers, required proofs, and action links.
 * This is what makes MigraPilot feel like an autonomous engineer, not random automation.
 */

import type { ReasoningCardProps, RiskTier } from "../lib/ui-contracts";

const TIER_META: Record<RiskTier, { label: string; color: string; bg: string; tooltip: string }> = {
  T0: { label: "T0", color: "var(--ok)",     bg: "rgba(52,211,153,0.08)",  tooltip: "Read-only checks. Always safe to run." },
  T1: { label: "T1", color: "var(--warn)",   bg: "rgba(251,191,36,0.08)",  tooltip: "Reversible actions with verification." },
  T2: { label: "T2", color: "var(--danger)", bg: "rgba(248,113,113,0.08)", tooltip: "High impact. Requires approval in production." },
};

const MODE_META: Record<ReasoningCardProps["mode"], { label: string; color: string }> = {
  planOnly:    { label: "Plan-only",     color: "var(--muted)" },
  executeT0T1: { label: "Execute T0/T1", color: "var(--ok)" },
  t2Approval:  { label: "T2 Approval",   color: "var(--danger)" },
};

const STEP_STATUS_ICON: Record<string, { icon: string; color: string }> = {
  pending: { icon: "○", color: "var(--muted)" },
  running: { icon: "◎", color: "var(--warn)" },
  ok:      { icon: "●", color: "var(--ok)" },
  failed:  { icon: "✕", color: "var(--danger)" },
  blocked: { icon: "⊘", color: "var(--danger)" },
};

const PROOF_LINK_ICONS: Record<string, string> = {
  "ops-report":     "📄",
  "ops-release":    "🚀",
  "activity-proof": "✅",
  "other":          "🔗",
};

export function ReasoningCard({
  intentLabel,
  confidencePct,
  mode,
  planLine,
  steps,
  proofsRequired,
  approvalNotice,
  runId,
  proofLinks,
  actions,
}: ReasoningCardProps) {
  const modeInfo = MODE_META[mode];
  const hasT2 = steps.some((s) => s.tier === "T2");

  return (
    <div className="reasoning-card fade-in">
      {/* ── Header ── */}
      <div className="reasoning-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="var(--accent)" style={{ flexShrink: 0 }}>
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11zM7.25 5h1.5v4h-1.5V5zm0 5h1.5v1.5h-1.5V10z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--accent)" }}>
            Plan &amp; Proof
          </span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: modeInfo.color, padding: "1px 6px", border: `1px solid ${modeInfo.color}44`, borderRadius: 8 }}>
          {modeInfo.label}
        </span>
      </div>

      <div className="reasoning-body">
        {/* Intent + Confidence */}
        <div className="reasoning-row">
          <span className="reasoning-label">Intent</span>
          <span className="reasoning-value">{intentLabel}</span>
        </div>
        {confidencePct !== undefined && (
          <div className="reasoning-row">
            <span className="reasoning-label">Confidence</span>
            <span className="reasoning-value" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: confidencePct > 70 ? "var(--ok)" : confidencePct > 40 ? "var(--warn)" : "var(--danger)" }}>
                {confidencePct}%
              </span>
              <span style={{ flex: 1, height: 4, background: "var(--line)", borderRadius: 2, overflow: "hidden", maxWidth: 80 }}>
                <span style={{ display: "block", height: "100%", width: `${confidencePct}%`, background: confidencePct > 70 ? "var(--ok)" : confidencePct > 40 ? "var(--warn)" : "var(--danger)", borderRadius: 2 }} />
              </span>
            </span>
          </div>
        )}

        {/* Plan summary line */}
        {planLine && (
          <div className="reasoning-row">
            <span className="reasoning-label">Plan</span>
            <span className="reasoning-value" style={{ fontStyle: "italic" }}>{planLine}</span>
          </div>
        )}

        {/* Steps */}
        {steps.length > 0 && (
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {steps.map((step, idx) => {
              const tier = TIER_META[step.tier];
              const ss = STEP_STATUS_ICON[step.status ?? "pending"];
              return (
                <div
                  key={step.id}
                  style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 8px", borderRadius: 6, background: tier.bg, border: `1px solid ${tier.color}22` }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, color: ss.color, lineHeight: 1.8, minWidth: 10 }}>{ss.icon}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.8, minWidth: 14, textAlign: "center" }}>{idx + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>{step.name}</div>
                    {step.detail && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{step.detail}</div>}
                    {step.expectedProofs && step.expectedProofs.length > 0 && (
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>proofs: {step.expectedProofs.join(", ")}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: tier.color, padding: "1px 6px", border: `1px solid ${tier.color}44`, borderRadius: 6, flexShrink: 0 }} title={tier.tooltip}>
                    {tier.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Proofs required */}
        {proofsRequired && proofsRequired.length > 0 && (
          <>
            <div className="reasoning-row" style={{ marginTop: 8 }}>
              <span className="reasoning-label">Proofs</span>
              <span className="reasoning-value" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {proofsRequired.map((p) => (
                  <span key={p} style={{ fontSize: 10, padding: "1px 6px", border: "1px solid var(--line)", borderRadius: 6, background: "rgba(99,102,241,0.06)", color: "var(--accent)" }}>
                    {p}
                  </span>
                ))}
              </span>
            </div>
            <div style={{ marginTop: 2, fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>No proof = treated as failed.</div>
          </>
        )}

        {/* Approval notice */}
        {(hasT2 || approvalNotice) && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, fontSize: 11, color: "var(--danger)" }}>
            {approvalNotice ?? "Some steps require approval. An approval card will be created instead of executing."}
          </div>
        )}

        {/* Run ID */}
        {runId && (
          <div className="reasoning-row" style={{ marginTop: 8 }}>
            <span className="reasoning-label">Run ID</span>
            <span className="reasoning-value" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{runId}</span>
          </div>
        )}

        {/* Proof links */}
        {proofLinks && proofLinks.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {proofLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                style={{ fontSize: 11, padding: "3px 8px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
              >
                <span>{PROOF_LINK_ICONS[link.kind ?? "other"] ?? "🔗"}</span>
                {link.label}
              </a>
            ))}
          </div>
        )}

        {/* Actions */}
        {actions && actions.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {actions.map((action) => (
              <button key={action.id} onClick={action.onClick} disabled={action.disabled} style={{ fontSize: 11, padding: "3px 10px" }}>
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
