"use client";

/**
 * IntelligenceLoopIndicator: Shows the 7-phase MigraPilot intelligence cycle.
 * Understand → Enrich → Plan → Execute → Verify → Summarize → Learn
 * Displays as a compact horizontal progress indicator in the console header.
 */

export type LoopPhase = "idle" | "understand" | "enrich" | "plan" | "execute" | "verify" | "summarize" | "learn";

interface IntelligenceLoopIndicatorProps {
  currentPhase: LoopPhase;
}

const phases: { key: LoopPhase; label: string; icon: string }[] = [
  { key: "understand", label: "Understand", icon: "🧠" },
  { key: "enrich", label: "Enrich", icon: "📡" },
  { key: "plan", label: "Plan", icon: "📋" },
  { key: "execute", label: "Execute", icon: "⚡" },
  { key: "verify", label: "Verify", icon: "✓" },
  { key: "summarize", label: "Summarize", icon: "📊" },
  { key: "learn", label: "Learn", icon: "💾" },
];

export function IntelligenceLoopIndicator({ currentPhase }: IntelligenceLoopIndicatorProps) {
  if (currentPhase === "idle") return null;

  const activeIndex = phases.findIndex((p) => p.key === currentPhase);

  return (
    <div className="loop-indicator fade-in">
      {phases.map((phase, index) => {
        const isPast = index < activeIndex;
        const isActive = index === activeIndex;
        const isFuture = index > activeIndex;

        return (
          <div key={phase.key} className="loop-phase" style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <div
              className={`loop-dot ${isActive ? "loop-dot-active" : ""}`}
              style={{
                color: isPast ? "var(--ok)" : isActive ? "var(--accent)" : "var(--muted)",
                opacity: isFuture ? 0.4 : 1,
              }}
              title={phase.label}
            >
              <span style={{ fontSize: 10 }}>{isPast ? "✓" : phase.icon}</span>
              {isActive && (
                <span style={{ fontSize: 9, fontWeight: 600, marginTop: 1 }}>{phase.label}</span>
              )}
            </div>
            {index < phases.length - 1 && (
              <div
                className="loop-connector"
                style={{
                  background: isPast ? "var(--ok)" : "var(--line)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
