"use client";

import Link from "next/link";

interface InboxItemCardProps {
  id: string;
  type: "mission" | "drift" | "approval" | "notification";
  severity: "info" | "warn" | "critical";
  title: string;
  message: string;
  deepLink: string;
  createdAt: string;
  meta?: Record<string, unknown>;
  onAcknowledge?: (id: string) => void;
  onExecuteNow?: (id: string) => void;
  onRetry?: (id: string) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  warn: "#f59e0b",
  info: "#3b82f6",
};

const SEVERITY_BG: Record<string, string> = {
  critical: "rgba(239,68,68,0.08)",
  warn: "rgba(245,158,11,0.08)",
  info: "rgba(59,130,246,0.06)",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function primaryActionLabel(type: string, meta?: Record<string, unknown>): string {
  switch (type) {
    case "approval": return "Approve";
    case "drift": return "Open Diff";
    case "notification": return "View";
    case "mission":
      if (meta?.remainingSecs !== undefined && meta.remainingSecs !== null) return "Review Plan";
      return "View";
    default: return "View";
  }
}

export function InboxItemCard({
  id,
  type,
  severity,
  title,
  message,
  deepLink,
  createdAt,
  meta,
  onAcknowledge,
  onExecuteNow,
  onRetry,
}: InboxItemCardProps) {
  const color = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info;
  const bg = SEVERITY_BG[severity] ?? SEVERITY_BG.info;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
        borderLeft: `3px solid ${color}`,
        background: bg,
        borderRadius: "0 6px 6px 0",
        marginBottom: "0.5rem",
      }}
    >
      {/* Severity dot */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          marginTop: 6,
          flexShrink: 0,
        }}
      />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
          <strong style={{ fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </strong>
          <span style={{ fontSize: "0.75rem", color: "#888", whiteSpace: "nowrap" }}>
            {timeAgo(createdAt)}
          </span>
        </div>

        <p style={{ margin: "0.25rem 0 0.5rem", fontSize: "0.82rem", color: "#aaa", lineHeight: 1.4 }}>
          {message}
        </p>

        {/* Countdown for proposed missions */}
        {meta?.remainingSecs !== undefined && meta.remainingSecs !== null && (
          <span style={{ fontSize: "0.75rem", color: "#f59e0b", marginRight: "0.5rem" }}>
            {"\u23F1"} {String(meta.remainingSecs)}s left
          </span>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link
            href={deepLink}
            style={{
              fontSize: "0.78rem",
              padding: "0.25rem 0.6rem",
              borderRadius: 4,
              background: color,
              color: "#fff",
              textDecoration: "none",
            }}
          >
            {primaryActionLabel(type, meta)}
          </Link>

          {type === "notification" && onAcknowledge && (
            <button
              onClick={() => onAcknowledge(id)}
              style={{
                fontSize: "0.78rem",
                padding: "0.25rem 0.6rem",
                borderRadius: 4,
                background: "transparent",
                border: `1px solid ${color}`,
                color,
                cursor: "pointer",
              }}
            >
              Acknowledge
            </button>
          )}

          {type === "mission" && meta?.remainingSecs !== undefined && onExecuteNow && (
            <button
              onClick={() => onExecuteNow(id)}
              style={{
                fontSize: "0.78rem",
                padding: "0.25rem 0.6rem",
                borderRadius: 4,
                background: "transparent",
                border: "1px solid #22c55e",
                color: "#22c55e",
                cursor: "pointer",
              }}
            >
              Execute Now
            </button>
          )}

          {type === "mission" && severity !== "info" && onRetry && (
            <button
              onClick={() => onRetry(id)}
              style={{
                fontSize: "0.78rem",
                padding: "0.25rem 0.6rem",
                borderRadius: 4,
                background: "transparent",
                border: "1px solid #f59e0b",
                color: "#f59e0b",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
