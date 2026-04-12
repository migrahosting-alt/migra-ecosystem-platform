import { buildAutonomyReport } from "../services/report";

export function buildDailyStrategyReport() {
  const report = buildAutonomyReport();
  return {
    generatedAt: report.generatedAt,
    dashboard: report.dashboard,
    strategy: report.strategy,
    topDecisions: report.decisions.slice(0, 5)
  };
}
