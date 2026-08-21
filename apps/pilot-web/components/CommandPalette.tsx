"use client";

/**
 * CommandPalette — quick commands for common operations.
 *
 * Triggered by "/" in the input or Cmd+K.
 * Provides /health, /tail, /create, /search shortcuts.
 */

import { useState, useEffect, useRef, useCallback } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  template: string;
  icon: string;
  category: "operator" | "engineering" | "system";
}

const COMMANDS: PaletteCommand[] = [
  { id: "health", label: "/health", description: "Check system health", template: '/tool system.health {"correlationId":"<uuid>"}', icon: "💚", category: "system" },
  { id: "pods-list", label: "/pods", description: "List pods for a tenant", template: '/tool pods.list {"correlationId":"<uuid>","tenantId":"<tenant>","pagination":{"limit":20}}', icon: "📦", category: "operator" },
  { id: "dns-lookup", label: "/dns", description: "DNS lookup for a domain", template: '/tool dns.lookup {"correlationId":"<uuid>","tenantId":"<tenant>","domain":"<domain>"}', icon: "🌐", category: "operator" },
  { id: "logs-search", label: "/logs", description: "Search application logs", template: '/tool logs.search {"correlationId":"<uuid>","tenantId":"<tenant>","query":"<search>","limit":50}', icon: "📋", category: "operator" },
  { id: "create-pod", label: "/create pod", description: "Create a new pod", template: "Create a new pod for tenant <tenant> with plan <plan>", icon: "🚀", category: "operator" },
  { id: "repo-search", label: "/search", description: "Search codebase", template: "Search the codebase for: ", icon: "🔍", category: "engineering" },
  { id: "repo-read", label: "/read", description: "Read a file from the repo", template: "Show me the contents of ", icon: "📄", category: "engineering" },
  { id: "run-tests", label: "/test", description: "Run test suite", template: "Run the unit tests and report results", icon: "🧪", category: "engineering" },
  { id: "deploy", label: "/deploy", description: "Deploy to production", template: "Deploy the latest changes to production for tenant <tenant>", icon: "🚀", category: "operator" },
];

interface CommandPaletteProps {
  visible: boolean;
  filter: string;
  onSelect: (cmd: PaletteCommand) => void;
  onClose: () => void;
  mode?: "operator" | "engineering" | "incident";
}

const S = {
  container: {
    position: "absolute" as const, bottom: "100%", left: 0, right: 0,
    background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
    boxShadow: "0 -4px 24px rgba(0,0,0,0.3)", maxHeight: 280, overflowY: "auto" as const,
    zIndex: 100, marginBottom: 4,
  },
  header: {
    padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--fg-dim)",
    borderBottom: "1px solid var(--border)", textTransform: "uppercase" as const,
    letterSpacing: ".5px",
  },
  item: (selected: boolean) => ({
    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
    cursor: "pointer", fontSize: 12,
    background: selected ? "var(--bg-active)" : "transparent",
    color: "var(--fg-bright)",
  }),
  icon: { fontSize: 16, width: 24, textAlign: "center" as const },
  label: { fontWeight: 600, fontFamily: "var(--mono)", fontSize: 12 },
  desc: { fontSize: 11, color: "var(--fg-dim)", marginLeft: "auto" },
  empty: { padding: "12px 16px", fontSize: 12, color: "var(--fg-dim)", textAlign: "center" as const },
  kbd: {
    fontSize: 10, padding: "1px 4px", borderRadius: 3,
    border: "1px solid var(--border)", color: "var(--fg-dim)", marginLeft: 6,
  },
};

export function CommandPalette({ visible, filter, onSelect, onClose, mode }: CommandPaletteProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = COMMANDS.filter(cmd => {
    const matchesFilter = !filter ||
      cmd.label.toLowerCase().includes(filter.toLowerCase()) ||
      cmd.description.toLowerCase().includes(filter.toLowerCase());
    const matchesMode = !mode || cmd.category === "system" || cmd.category === mode;
    return matchesFilter && matchesMode;
  });

  useEffect(() => { setSelectedIdx(0); }, [filter]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!visible) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && filtered[selectedIdx]) { e.preventDefault(); onSelect(filtered[selectedIdx]); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }, [visible, filtered, selectedIdx, onSelect, onClose]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div ref={ref} style={S.container}>
      <div style={S.header}>
        Commands <span style={S.kbd}>↑↓</span> Navigate <span style={S.kbd}>Enter</span> Select <span style={S.kbd}>Esc</span> Close
      </div>
      {filtered.map((cmd, i) => (
        <div
          key={cmd.id}
          style={S.item(i === selectedIdx)}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setSelectedIdx(i)}
        >
          <span style={S.icon}>{cmd.icon}</span>
          <span style={S.label}>{cmd.label}</span>
          <span style={S.desc}>{cmd.description}</span>
        </div>
      ))}
    </div>
  );
}
