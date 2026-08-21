"use client";

/**
 * VerificationCard — renders post-change verification as a single card
 * that updates in-place. Attempts are shown inside the card, not as
 * separate timeline entries.
 *
 * Keyed by toolCallId so multiple concurrent mutations don't collide.
 *
 * Stream events consumed:
 *   - verification_attempt → update progress bar + live attempt count
 *   - verification → finalize card state (success/fail)
 */

import { useState } from "react";

/* ── Types ── */
export interface VerificationAttempt {
  attempt: number;
  maxAttempts: number;
  waitMs?: number;
  status: "waiting" | "checking" | "success" | "failed";
  timestamp?: string;
}

export interface VerificationData {
  toolCallId: string;
  toolName: string;
  verifyWith: string;
  strictness: "soft" | "hard";
  status: "verifying" | "verified" | "failed";
  attempts: VerificationAttempt[];
  currentAttempt: number;
  maxAttempts: number;
  durationMs?: number;
  summary?: string;
  startedAt?: string;
  nextAttemptAt?: string;
}

interface VerificationCardProps {
  data: VerificationData;
  defaultExpanded?: boolean;
}

/* ── Styles ── */
const S = {
  card: (status: "verifying" | "verified" | "failed"): React.CSSProperties => ({
    margin: "8px 20px",
    border: `1px solid ${
      status === "verified" ? "rgba(78,201,176,0.3)"
      : status === "failed" ? "rgba(248,81,73,0.3)"
      : "rgba(86,156,214,0.3)"
    }`,
    borderRadius: 10,
    overflow: "hidden",
    background: status === "verified"
      ? "rgba(78,201,176,0.04)"
      : status === "failed"
      ? "rgba(248,81,73,0.04)"
      : "rgba(86,156,214,0.04)",
    transition: "all .3s",
  }),

  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } as React.CSSProperties,

  statusIcon: (status: string): React.CSSProperties => ({
    fontSize: 16,
    flexShrink: 0,
    animation: status === "verifying" ? "spin 1.2s linear infinite" : "none",
  }),

  headerTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--fg-bright)",
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,

  arrow: {
    fontSize: 11,
    color: "var(--fg-dim)",
    fontWeight: 400,
  } as React.CSSProperties,

  badge: (color: string): React.CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    padding: "1px 6px",
    borderRadius: 3,
    border: `1px solid ${color}`,
    color,
    textTransform: "uppercase" as const,
    letterSpacing: ".3px",
    marginLeft: 4,
  }),

  meta: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 11,
    color: "var(--fg-dim)",
    flexShrink: 0,
  } as React.CSSProperties,

  metaItem: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    fontFamily: "var(--mono)",
    fontSize: 10,
  } as React.CSSProperties,

  /* ── Progress bar ── */
  progressWrap: {
    padding: "0 14px",
    paddingBottom: 10,
    paddingTop: 8,
  } as React.CSSProperties,

  progressBar: {
    height: 3,
    borderRadius: 2,
    background: "var(--border)",
    overflow: "hidden",
  } as React.CSSProperties,

  progressFill: (pct: number, color: string): React.CSSProperties => ({
    height: "100%",
    width: `${pct}%`,
    background: color,
    borderRadius: 2,
    transition: "width .5s ease-out",
  }),

  /* ── Summary ── */
  summary: (status: string): React.CSSProperties => ({
    padding: "8px 14px",
    fontSize: 12,
    color: status === "verified" ? "#4ec9b0" : status === "failed" ? "#f85149" : "var(--fg)",
    lineHeight: "1.45",
    borderTop: "1px solid var(--border)",
  }),

  /* ── Attempts expandable ── */
  attemptsToggle: {
    padding: "6px 14px",
    fontSize: 11,
    color: "var(--fg-dim)",
    cursor: "pointer",
    userSelect: "none" as const,
    borderTop: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    gap: 4,
  } as React.CSSProperties,

  attemptsList: {
    padding: "0 14px 10px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  } as React.CSSProperties,

  attemptRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    color: "var(--fg-dim)",
    fontFamily: "var(--mono)",
    padding: "2px 0",
  } as React.CSSProperties,

  attemptDot: (status: string): React.CSSProperties => ({
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: status === "success" ? "#4ec9b0" : status === "failed" ? "#f85149" : status === "checking" ? "#569cd6" : "#858585",
    flexShrink: 0,
  }),
};

/* ── Icons ── */
function statusIcon(status: "verifying" | "verified" | "failed") {
  if (status === "verified") return "✅";
  if (status === "failed") return "❌";
  return "⏳";
}

function statusLabel(status: "verifying" | "verified" | "failed") {
  if (status === "verified") return "Verified";
  if (status === "failed") return "Failed";
  return "Verifying";
}

function strictnessColor(s: "soft" | "hard") {
  return s === "hard" ? "#f85149" : "#d29922";
}

/* ── Component ── */
export function VerificationCard({ data, defaultExpanded = false }: VerificationCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const pct = data.maxAttempts > 0 ? (data.currentAttempt / data.maxAttempts) * 100 : 0;
  const progressColor = data.status === "verified" ? "#4ec9b0" : data.status === "failed" ? "#f85149" : "#569cd6";
  const dur = data.durationMs ? (data.durationMs / 1000).toFixed(1) : null;

  return (
    <>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={S.card(data.status)}>
        {/* Header */}
        <div style={S.header}>
          <span style={S.statusIcon(data.status)}>{statusIcon(data.status)}</span>
          <div style={S.headerTitle}>
            <span>Post-Change Verification</span>
          </div>
          <div style={S.meta}>
            <span style={S.metaItem}>
              {data.currentAttempt}/{data.maxAttempts}
            </span>
            {dur && <span style={S.metaItem}>{dur}s</span>}
          </div>
        </div>

        {/* Tool → Verifier line */}
        <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <span style={{ fontFamily: "var(--mono)", color: "var(--fg-bright)", fontWeight: 600 }}>{data.toolName}</span>
          <span style={S.arrow}>→</span>
          <span style={{ fontFamily: "var(--mono)", color: "var(--info, #569cd6)" }}>{data.verifyWith}</span>
          <span style={S.badge(strictnessColor(data.strictness))}>{data.strictness}</span>
        </div>

        {/* Progress bar (during verification) */}
        {data.status === "verifying" && (
          <div style={S.progressWrap}>
            <div style={S.progressBar}>
              <div style={S.progressFill(pct, progressColor)} />
            </div>
            {data.nextAttemptAt && (
              <div style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 4, fontFamily: "var(--mono)" }}>
                Next attempt at {new Date(data.nextAttemptAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}

        {/* Summary */}
        {data.summary && (
          <div style={S.summary(data.status)}>
            {data.summary}
          </div>
        )}

        {/* Attempts (expandable) */}
        {data.attempts.length > 0 && (
          <>
            <div
              style={S.attemptsToggle}
              onClick={() => setExpanded(!expanded)}
            >
              <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>▸</span>
              Attempts ({data.attempts.length})
            </div>
            {expanded && (
              <div style={S.attemptsList}>
                {data.attempts.map((a, i) => (
                  <div key={i} style={S.attemptRow}>
                    <span style={S.attemptDot(a.status)} />
                    <span style={{ color: "var(--fg-dim)" }}>Attempt {a.attempt}</span>
                    {a.waitMs !== undefined && a.waitMs > 0 && (
                      <span style={{ color: "var(--fg-dim)", opacity: 0.7 }}>
                        — wait {a.waitMs}ms
                      </span>
                    )}
                    <span style={{
                      marginLeft: "auto",
                      color: a.status === "success" ? "#4ec9b0" : a.status === "failed" ? "#f85149" : "var(--fg-dim)",
                      fontWeight: a.status === "success" ? 600 : 400,
                    }}>
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
