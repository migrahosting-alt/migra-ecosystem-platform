/**
 * PolicyTimeline — collapsible sidebar panel that shows policy
 * decisions emitted during a conversation run.
 *
 * Listens for SSE `policy_decision` events streamed from pilot-api.
 * Also fetches historical timeline via GET /api/pilot/policy/timeline/:id
 */
"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ── */
export type PolicyDecision = {
  ruleId: string;
  verdict: "allow" | "deny" | "approve";
  reason: string;
  toolName?: string;
  ts?: string;
};

/* ── Styles (matches PilotShell pattern) ── */
const S = {
  panel: (visible: boolean): React.CSSProperties => ({
    width: visible ? 300 : 0,
    minWidth: visible ? 300 : 0,
    transition: "width .2s, min-width .2s",
    overflow: "hidden",
    borderLeft: visible ? "1px solid var(--border)" : "none",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-sidebar)",
  }),
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } as React.CSSProperties,
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--fg-bright)",
    letterSpacing: ".3px",
    textTransform: "uppercase" as const,
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--fg-dim)",
    fontSize: 16,
    padding: "0 4px",
  } as React.CSSProperties,
  list: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "8px 10px",
  } as React.CSSProperties,
  item: {
    padding: "8px 10px",
    margin: "4px 0",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-input)",
  } as React.CSSProperties,
  verdictBadge: (v: string): React.CSSProperties => ({
    display: "inline-block",
    fontSize: 10,
    fontWeight: 700,
    padding: "1px 6px",
    borderRadius: 3,
    marginRight: 6,
    color: "#fff",
    background:
      v === "allow"
        ? "var(--success, #4ec9b0)"
        : v === "deny"
          ? "var(--danger, #f44747)"
          : "var(--warning, #cca700)",
  }),
  ruleId: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--fg-bright)",
  } as React.CSSProperties,
  reason: {
    fontSize: 12,
    color: "var(--fg-dim)",
    marginTop: 3,
    lineHeight: "1.4",
  } as React.CSSProperties,
  toolLabel: {
    fontSize: 11,
    color: "var(--fg-dim)",
    marginTop: 2,
    fontFamily: "var(--mono)",
  } as React.CSSProperties,
  ts: {
    fontSize: 10,
    color: "var(--fg-dim)",
    marginTop: 2,
  } as React.CSSProperties,
  empty: {
    padding: 20,
    textAlign: "center" as const,
    color: "var(--fg-dim)",
    fontSize: 12,
  } as React.CSSProperties,
  summary: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    fontSize: 11,
    color: "var(--fg-dim)",
    display: "flex",
    gap: 10,
  } as React.CSSProperties,
  summaryVal: {
    fontWeight: 600,
    color: "var(--fg-bright)",
  } as React.CSSProperties,
};

/* ── Helpers ── */
const ShieldIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path
      d="M8 1L2 3.5V7.5C2 11.1 4.6 14.3 8 15C11.4 14.3 14 11.1 14 7.5V3.5L8 1Z"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
    <path d="M6 8L7.5 9.5L10 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ── Component ── */
export function PolicyTimeline({
  decisions,
  visible,
  onClose,
}: {
  decisions: PolicyDecision[];
  visible: boolean;
  onClose: () => void;
}) {
  const counts = {
    allow: decisions.filter((d) => d.verdict === "allow").length,
    deny: decisions.filter((d) => d.verdict === "deny").length,
    approve: decisions.filter((d) => d.verdict === "approve").length,
  };

  return (
    <div style={S.panel(visible)}>
      <div style={S.header}>
        <span style={{ ...S.title, display: "flex", alignItems: "center", gap: 6 }}>
          <ShieldIcon /> Policy Timeline
        </span>
        <button style={S.closeBtn} onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {decisions.length > 0 && (
        <div style={S.summary}>
          <span>
            ✅ <span style={S.summaryVal}>{counts.allow}</span>
          </span>
          <span>
            ⛔ <span style={S.summaryVal}>{counts.deny}</span>
          </span>
          <span>
            ⏳ <span style={S.summaryVal}>{counts.approve}</span>
          </span>
          <span style={{ marginLeft: "auto" }}>
            Total: <span style={S.summaryVal}>{decisions.length}</span>
          </span>
        </div>
      )}

      <div style={S.list}>
        {decisions.length === 0 && (
          <div style={S.empty}>No policy decisions yet. Send a message to see evaluations.</div>
        )}

        {decisions.map((d, i) => (
          <div key={`pd-${i}`} style={S.item}>
            <div>
              <span style={S.verdictBadge(d.verdict)}>{d.verdict.toUpperCase()}</span>
              <span style={S.ruleId}>{d.ruleId}</span>
            </div>
            <div style={S.reason}>{d.reason}</div>
            {d.toolName && <div style={S.toolLabel}>🔧 {d.toolName}</div>}
            {d.ts && <div style={S.ts}>{new Date(d.ts).toLocaleTimeString()}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
