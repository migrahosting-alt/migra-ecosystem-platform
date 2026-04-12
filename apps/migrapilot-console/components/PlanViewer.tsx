"use client";

/**
 * PlanViewer: Shows the MigraPilot Intelligence Loop as a multi-step plan.
 * Each step: Understand → Enrich → Plan → Execute → Verify → Summarize
 * Steps can be pending, active, completed, or failed.
 */

export type PlanStepStatus = "pending" | "active" | "completed" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  label: string;
  description: string;
  status: PlanStepStatus;
  toolName?: string;
  riskTier?: number;
  output?: string;
  duration?: number;
}

interface PlanViewerProps {
  steps: PlanStep[];
  title?: string;
}

const statusConfig: Record<PlanStepStatus, { icon: string; color: string; bg: string }> = {
  pending: { icon: "○", color: "var(--muted)", bg: "transparent" },
  active: { icon: "◉", color: "var(--accent)", bg: "var(--accent-glow)" },
  completed: { icon: "✓", color: "var(--ok)", bg: "rgba(52, 211, 153, 0.08)" },
  failed: { icon: "✗", color: "var(--danger)", bg: "rgba(248, 113, 113, 0.08)" },
  skipped: { icon: "—", color: "var(--muted)", bg: "transparent" },
};

export function PlanViewer({ steps, title }: PlanViewerProps) {
  const completedCount = steps.filter((s) => s.status === "completed").length;
  const activeStep = steps.find((s) => s.status === "active");
  const progress = steps.length > 0 ? (completedCount / steps.length) * 100 : 0;

  return (
    <div className="plan-viewer fade-in">
      {/* Header with progress */}
      <div className="plan-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>{"📋"}</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{title ?? "Execution Plan"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            {completedCount}/{steps.length}
          </span>
          <div className="plan-progress-track">
            <div className="plan-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* Active step highlight */}
      {activeStep && (
        <div className="plan-active-step">
          <span className="status-spinner" style={{ width: 12, height: 12 }} />
          <span style={{ fontSize: 12, color: "var(--accent)" }}>
            {activeStep.label}
            {activeStep.toolName && (
              <span style={{ fontFamily: "var(--mono)", opacity: 0.7, marginLeft: 6 }}>
                {activeStep.toolName}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Step list */}
      <div className="plan-steps">
        {steps.map((step, index) => {
          const config = statusConfig[step.status];
          return (
            <div key={step.id} className={`plan-step ${step.status === "active" ? "plan-step-active" : ""}`}>
              {/* Connector line */}
              <div className="plan-step-connector">
                <div
                  className="plan-step-dot"
                  style={{ color: config.color, background: config.bg, borderColor: config.color }}
                >
                  {step.status === "active" ? (
                    <span className="status-spinner" style={{ width: 10, height: 10 }} />
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700 }}>{config.icon}</span>
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className="plan-step-line"
                    style={{
                      background: step.status === "completed" ? "var(--ok)" : "var(--line)",
                    }}
                  />
                )}
              </div>

              {/* Step content */}
              <div className="plan-step-content">
                <div style={{
                  fontSize: 12,
                  fontWeight: step.status === "active" ? 600 : 500,
                  color: step.status === "pending" || step.status === "skipped"
                    ? "var(--muted)"
                    : "var(--text)",
                }}>
                  {step.label}
                  {step.toolName && (
                    <span style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--muted)",
                      marginLeft: 8,
                      padding: "1px 6px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: 3,
                    }}>
                      {step.toolName}
                    </span>
                  )}
                  {step.riskTier !== undefined && (
                    <span style={{
                      fontSize: 10,
                      marginLeft: 6,
                      color: step.riskTier === 0 ? "var(--ok)" : step.riskTier === 1 ? "var(--warn)" : "var(--danger)",
                    }}>
                      T{step.riskTier}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  {step.description}
                </div>
                {step.output && (
                  <div style={{
                    fontSize: 11, color: "var(--ok)", fontFamily: "var(--mono)",
                    marginTop: 4, padding: "2px 0",
                  }}>
                    {step.output}
                  </div>
                )}
                {step.duration !== undefined && step.status === "completed" && (
                  <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)", marginTop: 2 }}>
                    {step.duration}ms
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
