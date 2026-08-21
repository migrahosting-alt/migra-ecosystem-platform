"use client";

/**
 * ModeSwitch — toggles between Operator, Engineering, and Incident modes.
 *
 * Operator mode: infrastructure tools (pods, domains, DNS, mail, backups) — blue accent
 * Engineering mode: repo tools (search, readFile, applyPatch, tests, format) — orange accent
 * Incident mode: triage and response (future) — red accent
 *
 * The mode accent color propagates via CSS custom properties for themed header.
 */

export type PilotMode = "operator" | "engineering" | "incident";

/* ── Mode config ── */
const MODE_CONFIG: Record<PilotMode, { icon: string; label: string; color: string; description: string }> = {
  operator:    { icon: "🔧", label: "Operator",    color: "#0078d4", description: "Infrastructure operations: pods, domains, DNS, mail, backups" },
  engineering: { icon: "⚡", label: "Engineering", color: "#e8823a", description: "Code operations: search, read, patch, test, format" },
  incident:    { icon: "🚨", label: "Incident",    color: "#f85149", description: "Incident triage and response (coming soon)" },
};

export function getModeColor(mode: PilotMode): string {
  return MODE_CONFIG[mode].color;
}

interface ModeSwitchProps {
  mode: PilotMode;
  onChange: (mode: PilotMode) => void;
  disableIncident?: boolean;
}

const S = {
  container: {
    display: "flex", alignItems: "center", gap: 0,
    border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden",
    fontSize: 11, fontWeight: 600, letterSpacing: ".3px",
  },
  tab: (active: boolean, color: string, disabled: boolean) => ({
    padding: "5px 12px", cursor: disabled ? "default" : "pointer", userSelect: "none" as const,
    background: active ? color : "transparent",
    color: active ? "#fff" : disabled ? "var(--border)" : "var(--fg-dim)",
    transition: "background .15s, color .15s",
    border: "none", outline: "none",
    opacity: disabled ? 0.4 : 1,
  }),
};

export function ModeSwitch({ mode, onChange, disableIncident = true }: ModeSwitchProps) {
  return (
    <div style={S.container}>
      {(Object.keys(MODE_CONFIG) as PilotMode[]).map((m) => {
        const cfg = MODE_CONFIG[m];
        const disabled = m === "incident" && disableIncident;
        return (
          <button
            key={m}
            style={S.tab(mode === m, cfg.color, disabled)}
            onClick={() => !disabled && onChange(m)}
            title={cfg.description + (disabled ? " (disabled)" : "")}
            disabled={disabled}
          >
            {cfg.icon} {cfg.label}
          </button>
        );
      })}
    </div>
  );
}
