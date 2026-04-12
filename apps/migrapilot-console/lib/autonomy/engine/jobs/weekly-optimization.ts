import { buildAutonomyReport } from "../services/report";

export function buildWeeklyOptimizationPlan() {
  const report = buildAutonomyReport();
  return {
    generatedAt: report.generatedAt,
    recommendations: report.strategy,
    gatedActions: report.actions.filter((action) => action.executionStatus === "gated"),
    safeActions: report.actions.filter((action) => action.executionStatus !== "gated")
  };
}
