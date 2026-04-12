import type { ActionRisk, Decision } from "../models";

export function assessDecisionRisk(decision: Decision): ActionRisk {
  switch (decision.recommendedAction) {
    case "tighten_autonomy_and_review":
      return { level: "HIGH", requiresOwnerApproval: true, reason: "Changes autonomy posture and can affect execution policy." };
    case "run_infrastructure_diagnostic":
      return {
        level: "LOW",
        requiresOwnerApproval: false,
        reason: "Read-only infrastructure diagnostic using inventory and topology data only."
      };
    case "trigger_revenue_follow_up":
      return {
        level: decision.priority <= 65 && decision.confidence <= 0.8 ? "LOW" : "MEDIUM",
        requiresOwnerApproval: false,
        reason:
          decision.priority <= 65 && decision.confidence <= 0.8
            ? "Internal pipeline follow-up only. No pricing, contract, or provisioning change."
            : "Touches customer pipeline but does not change pricing or contracts."
      };
    case "increase_growth_output":
    case "replicate_high_signal_content":
      return { level: "LOW", requiresOwnerApproval: false, reason: "Safe marketing-side optimization proposal." };
    case "clear_backlog_and_review_failures":
      return { level: "LOW", requiresOwnerApproval: false, reason: "Operational triage only." };
    default:
      return { level: "MEDIUM", requiresOwnerApproval: false, reason: "Unclassified decision requires cautious handling." };
  }
}
