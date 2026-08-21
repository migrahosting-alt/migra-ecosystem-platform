"use client";

/**
 * ReadOnlyBanner — sticky top banner when hard verification fails.
 *
 * Shows the failed tool, reason, and provides View Details + Rollback actions.
 * Sits above the chat area as a persistent warning.
 */

export interface ReadOnlyInfo {
  failedToolCallId: string;
  failedToolName?: string;
  reason?: string;
  timestamp?: string;
}

interface ReadOnlyBannerProps {
  info: ReadOnlyInfo;
  onViewDetails: () => void;
  onRollback: () => void;
  onDismiss?: () => void;
}

const S = {
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 20px",
    background: "rgba(248,81,73,0.1)",
    borderBottom: "2px solid #f85149",
    flexShrink: 0,
    animation: "slideDown .25s ease-out",
  } as React.CSSProperties,

  icon: {
    fontSize: 18,
    flexShrink: 0,
  } as React.CSSProperties,

  content: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,

  title: {
    fontSize: 12,
    fontWeight: 700,
    color: "#f85149",
    letterSpacing: ".3px",
    textTransform: "uppercase" as const,
    marginBottom: 2,
  } as React.CSSProperties,

  detail: {
    fontSize: 12,
    color: "var(--fg)",
    lineHeight: "1.4",
  } as React.CSSProperties,

  toolName: {
    fontFamily: "var(--mono)",
    fontWeight: 600,
    color: "#f85149",
    fontSize: 12,
  } as React.CSSProperties,

  actions: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  } as React.CSSProperties,

  btn: (danger: boolean): React.CSSProperties => ({
    padding: "5px 12px",
    borderRadius: 6,
    border: `1px solid ${danger ? "#f85149" : "var(--border)"}`,
    background: danger ? "rgba(248,81,73,0.15)" : "transparent",
    color: danger ? "#f85149" : "var(--fg-bright)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
    transition: "all .15s",
  }),
};

export function ReadOnlyBanner({ info, onViewDetails, onRollback, onDismiss }: ReadOnlyBannerProps) {
  return (
    <>
      <style>{`@keyframes slideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div style={S.banner}>
        <span style={S.icon}>🔒</span>
        <div style={S.content}>
          <div style={S.title}>Read-Only Mode Active</div>
          <div style={S.detail}>
            Hard verification failed for{" "}
            <span style={S.toolName}>{info.failedToolName ?? info.failedToolCallId}</span>.
            {" "}Further mutations blocked until resolved.
            {info.reason && <span style={{ color: "var(--fg-dim)" }}> — {info.reason}</span>}
          </div>
        </div>
        <div style={S.actions}>
          <button style={S.btn(false)} onClick={onViewDetails}>View Details</button>
          <button style={S.btn(true)} onClick={onRollback}>Rollback</button>
        </div>
      </div>
    </>
  );
}
