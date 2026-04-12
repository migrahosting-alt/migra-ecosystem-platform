import { randomUUID } from "node:crypto";

import type { Action, Decision } from "../models";
import { assessDecisionRisk } from "./risk-manager";

const commandByAction: Record<string, string> = {
  increase_growth_output: "pilot run growth.generate_content",
  trigger_revenue_follow_up: "pilot run revenue.advance_pipeline",
  run_infrastructure_diagnostic: "pilot run autonomy.observe",
  tighten_autonomy_and_review: "pilot run autonomy.decide",
  replicate_high_signal_content: "pilot run growth.generate_content",
  clear_backlog_and_review_failures: "pilot run autonomy.report"
};

export function orchestrateActions(decisions: Decision[], options?: { executeLowRisk?: boolean }): Action[] {
  return decisions.map((decision) => {
    const risk = assessDecisionRisk(decision);
    const executionStatus = risk.requiresOwnerApproval
      ? "gated"
      : options?.executeLowRisk && risk.level === "LOW"
        ? "simulated"
        : "planned";

    return {
      id: `act_${randomUUID()}`,
      type: decision.recommendedAction,
      targetSystem: decision.recommendedAction.includes("growth")
        ? "MigraGrowth"
        : decision.recommendedAction.includes("revenue")
          ? "MigraRevenue"
          : "MigraPilot",
      parameters: {
        decisionId: decision.id,
        priority: decision.priority,
        confidence: decision.confidence
      },
      executionStatus,
      risk,
      suggestedCommand: commandByAction[decision.recommendedAction]
    };
  });
}
