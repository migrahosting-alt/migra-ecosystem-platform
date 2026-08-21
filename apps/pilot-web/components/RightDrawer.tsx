"use client";

/**
 * RightDrawer — generic docked right drawer panel.
 *
 * Replaces floating panels for Sources, Policy, and State.
 * Slides in from the right with consistent header and close behavior.
 */

import { useEffect, useRef } from "react";

interface RightDrawerProps {
  title: string;
  icon: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  accentColor?: string;
}

const S = {
  drawer: (visible: boolean, width: number): React.CSSProperties => ({
    width: visible ? width : 0,
    minWidth: visible ? width : 0,
    transition: "width .2s ease, min-width .2s ease",
    overflow: "hidden",
    borderLeft: visible ? "1px solid var(--border)" : "none",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-sidebar)",
    flexShrink: 0,
    position: "relative",
  }),

  header: (accentColor?: string): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: `1px solid ${accentColor ? accentColor + "40" : "var(--border)"}`,
    flexShrink: 0,
    background: accentColor ? `${accentColor}08` : "transparent",
  }),

  titleWrap: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,

  icon: {
    fontSize: 14,
  } as React.CSSProperties,

  title: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--fg-bright)",
    letterSpacing: ".3px",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,

  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--fg-dim)",
    fontSize: 16,
    padding: "0 4px",
    lineHeight: 1,
    transition: "color .15s",
  } as React.CSSProperties,

  body: {
    flex: 1,
    overflowY: "auto" as const,
    overflowX: "hidden" as const,
    padding: "8px 0",
  } as React.CSSProperties,
};

export function RightDrawer({
  title,
  icon,
  visible,
  onClose,
  children,
  width = 320,
  accentColor,
}: RightDrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, onClose]);

  return (
    <div style={S.drawer(visible, width)}>
      {visible && (
        <>
          <div style={S.header(accentColor)}>
            <div style={S.titleWrap}>
              <span style={S.icon}>{icon}</span>
              <span style={S.title}>{title}</span>
            </div>
            <button style={S.closeBtn} onClick={onClose} title="Close">✕</button>
          </div>
          <div style={S.body}>
            {children}
          </div>
        </>
      )}
    </div>
  );
}
