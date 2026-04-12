import { JourneyStage } from "@prisma/client";

interface JourneyData {
  stage: JourneyStage;
  score: number;
  productsActive: number;
  churnRiskScore: number;
  firstProductAt: Date | null;
  lastActivityAt: Date | null;
}

interface JourneyWidgetProps {
  journey: JourneyData | null;
  productsActive: number;
}

const stageColors: Record<string, string> = {
  ONBOARDING: "bg-gray-100 text-gray-700",
  ACTIVATED: "bg-blue-100 text-blue-700",
  ENGAGED: "bg-green-100 text-green-700",
  POWER_USER: "bg-purple-100 text-purple-700",
  AT_RISK: "bg-amber-100 text-amber-700",
  CHURNED: "bg-red-100 text-red-700",
};

const stageLabels: Record<string, string> = {
  ONBOARDING: "Onboarding",
  ACTIVATED: "Activated",
  ENGAGED: "Engaged",
  POWER_USER: "Power User",
  AT_RISK: "At Risk",
  CHURNED: "Churned",
};

export function JourneyWidget({ journey, productsActive }: JourneyWidgetProps) {
  const stage = journey?.stage ?? "ONBOARDING";
  const score = journey?.score ?? 0;
  const churnRisk = journey?.churnRiskScore ?? 50;

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Customer Journey</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${stageColors[stage] ?? "bg-gray-100 text-gray-700"}`}>
          {stageLabels[stage] ?? stage}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Lifecycle health and adoption progress.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Health score</p>
          <p className="mt-1 text-xl font-bold">{score}<span className="text-sm font-normal text-[var(--ink-muted)]">/100</span></p>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${score}%`,
                backgroundColor: score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Products active</p>
          <p className="mt-1 text-xl font-bold">{productsActive}</p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Churn risk</p>
          <p className="mt-1 text-xl font-bold">{churnRisk}<span className="text-sm font-normal text-[var(--ink-muted)]">%</span></p>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${churnRisk}%`,
                backgroundColor: churnRisk <= 30 ? "#22c55e" : churnRisk <= 60 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
