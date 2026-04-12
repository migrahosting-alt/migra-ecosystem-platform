import type { AutonomyState } from "../../types";
import type { ExecutiveDashboardSnapshot, Signal } from "../models";

export function buildExecutiveDashboard(state: AutonomyState, signals: Signal[], actionCount: number): ExecutiveDashboardSnapshot {
  const queueCounts = state.queue.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const openRisks = signals.filter((signal) => signal.type === "infrastructure_risk" || signal.type === "system_anomaly").length;

  return {
    generatedAt: new Date().toISOString(),
    metrics: [
      { label: "Autonomy Confidence", value: `${Math.round(state.confidence.score * 100)}%`, tone: state.confidence.score >= 0.8 ? "success" : state.confidence.score >= 0.5 ? "warning" : "danger" },
      { label: "Queued Missions", value: String(queueCounts.queued ?? 0), tone: (queueCounts.queued ?? 0) > 0 ? "warning" : "neutral" },
      { label: "Awaiting Approval", value: String(queueCounts.awaiting_approval ?? 0), tone: (queueCounts.awaiting_approval ?? 0) > 0 ? "warning" : "neutral" },
      { label: "Failed Runs", value: String(queueCounts.failed ?? 0), tone: (queueCounts.failed ?? 0) > 0 ? "danger" : "success" },
      { label: "Open Risks", value: String(openRisks), tone: openRisks > 0 ? "danger" : "success" },
      { label: "Recommended Actions", value: String(actionCount), tone: actionCount > 0 ? "warning" : "neutral" }
    ],
    topSignal: signals[0],
    openRisks,
    recommendedActions: actionCount
  };
}
