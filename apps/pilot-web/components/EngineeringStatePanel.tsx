/**
 * EngineeringStatePanel — right-side panel showing the persistent
 * engineering state (architecture, implemented features, todos, risks).
 *
 * Fetches from GET /api/pilot/memory/state and can receive live
 * updates via SSE `memory_update` events.
 */
"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ── */
export type EngineeringState = {
  architecture?: string[];
  implemented?: string[];
  todos?: string[];
  risks?: string[];
  notes?: string[];
  [k: string]: string[] | undefined;
};

/* ── Styles ── */
const S = {
  panel: (visible: boolean): React.CSSProperties => ({
    width: visible ? 320 : 0,
    minWidth: visible ? 320 : 0,
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
  body: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "8px 10px",
  } as React.CSSProperties,
  section: {
    marginBottom: 12,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--fg-bright)",
    textTransform: "uppercase" as const,
    letterSpacing: ".4px",
    marginBottom: 4,
    display: "flex",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,
  chip: (color: string): React.CSSProperties => ({
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 3,
    marginRight: 4,
    marginBottom: 3,
    border: `1px solid ${color}`,
    color,
    background: "transparent",
  }),
  listItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    padding: "3px 0",
    fontSize: 12,
    color: "var(--fg)",
    lineHeight: "1.45",
  } as React.CSSProperties,
  bullet: (color: string): React.CSSProperties => ({
    marginTop: 4,
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
  empty: {
    padding: 20,
    textAlign: "center" as const,
    color: "var(--fg-dim)",
    fontSize: 12,
  } as React.CSSProperties,
  refreshBtn: {
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "3px 8px",
    cursor: "pointer",
    color: "var(--fg-dim)",
    fontSize: 11,
  } as React.CSSProperties,
  count: {
    fontSize: 10,
    color: "var(--fg-dim)",
    fontWeight: 400,
    marginLeft: 4,
  } as React.CSSProperties,
};

/* ── Icons ── */
const BrainIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path
      d="M8 2C5.8 2 4 3.8 4 6C4 7.4 4.8 8.6 6 9.2V14H10V9.2C11.2 8.6 12 7.4 12 6C12 3.8 10.2 2 8 2Z"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
    <path d="M6 6H10" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M7 4.5V7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M9 4.5V7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

/* ── Section configs ── */
const SECTIONS: {
  key: string;
  label: string;
  icon: string;
  color: string;
}[] = [
  { key: "architecture", label: "Architecture", icon: "🏗️", color: "var(--info, #569cd6)" },
  { key: "implemented", label: "Implemented", icon: "✅", color: "var(--success, #4ec9b0)" },
  { key: "todos", label: "TODOs", icon: "📋", color: "var(--warning, #cca700)" },
  { key: "risks", label: "Risks", icon: "⚠️", color: "var(--danger, #f44747)" },
  { key: "notes", label: "Notes", icon: "📝", color: "var(--fg-dim, #858585)" },
];

const API_BASE = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://localhost:3377";

/* ── Component ── */
export function EngineeringStatePanel({
  visible,
  onClose,
  liveState,
}: {
  visible: boolean;
  onClose: () => void;
  liveState?: EngineeringState | null;
}) {
  const [state, setState] = useState<EngineeringState | null>(liveState ?? null);
  const [loading, setLoading] = useState(false);

  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(`${API_BASE}/api/pilot/memory/state`, { headers });
      if (r.ok) {
        const d = await r.json();
        setState(d.data ?? null);
      }
    } catch {
      /* swallow */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible && !state) fetchState();
  }, [visible, state, fetchState]);

  // Merge live state updates from SSE
  useEffect(() => {
    if (liveState) setState(liveState);
  }, [liveState]);

  const data = state ?? {};
  const isEmpty = SECTIONS.every((s) => !data[s.key]?.length);

  return (
    <div style={S.panel(visible)}>
      <div style={S.header}>
        <span style={{ ...S.title, display: "flex", alignItems: "center", gap: 6 }}>
          <BrainIcon /> Engineering State
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={S.refreshBtn} onClick={fetchState} title="Refresh">
            {loading ? "…" : "↻"}
          </button>
          <button style={S.closeBtn} onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div style={S.body}>
        {isEmpty && (
          <div style={S.empty}>
            No engineering state recorded yet. MigraPilot will populate this as it works.
          </div>
        )}

        {SECTIONS.map((sec) => {
          const items = data[sec.key];
          if (!items?.length) return null;
          return (
            <div key={sec.key} style={S.section}>
              <div style={S.sectionTitle}>
                <span>{sec.icon}</span>
                {sec.label}
                <span style={S.count}>({items.length})</span>
              </div>
              {items.map((item, i) => (
                <div key={`${sec.key}-${i}`} style={S.listItem}>
                  <div style={S.bullet(sec.color)} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          );
        })}

        {/* Extra sections not in default list */}
        {Object.keys(data)
          .filter((k) => !SECTIONS.some((s) => s.key === k) && data[k]?.length)
          .map((k) => (
            <div key={k} style={S.section}>
              <div style={S.sectionTitle}>
                <span>📎</span>
                {k}
                <span style={S.count}>({data[k]!.length})</span>
              </div>
              {data[k]!.map((item, i) => (
                <div key={`${k}-${i}`} style={S.listItem}>
                  <div style={S.bullet("var(--fg-dim)")} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
