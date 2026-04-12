import type { Decision, Signal, StrategyRecommendation } from "../models";

export function generateStrategy(signals: Signal[], decisions: Decision[]): StrategyRecommendation[] {
  const recommendations: StrategyRecommendation[] = [];

  if (signals.some((signal) => signal.type === "marketing_momentum")) {
    recommendations.push({
      id: "strategy_marketing_momentum",
      title: "Increase founder-led growth output",
      summary: "Marketing-side momentum is visible in the current signal set.",
      reason: "When content is already pulling attention, more of the same format is the lowest-risk growth lever.",
      priority: 80
    });
  }

  if (signals.some((signal) => signal.type === "revenue_opportunity")) {
    recommendations.push({
      id: "strategy_revenue_followup",
      title: "Shorten revenue response time",
      summary: "Revenue-side signals indicate live pipeline movement that should not sit idle.",
      reason: "Lead and proposal velocity usually drops when follow-up is delayed.",
      priority: 78
    });
  }

  if (signals.some((signal) => signal.type === "infrastructure_risk" || signal.type === "system_anomaly")) {
    recommendations.push({
      id: "strategy_risk_posture",
      title: "Hold the system in conservative mode",
      summary: "Autonomy is seeing infrastructure risk or confidence degradation.",
      reason: "Risk signals should reduce automation aggressiveness until the operator confirms stability.",
      priority: 90
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "strategy_stable",
      title: "Maintain current autonomy posture",
      summary: "No dominant cross-system signal currently justifies a posture change.",
      reason: `Observed ${decisions.length} decisions without a concentrated risk cluster.`,
      priority: 40
    });
  }

  return recommendations.sort((a, b) => b.priority - a.priority);
}
