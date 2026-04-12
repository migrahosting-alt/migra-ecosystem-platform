import { randomUUID } from "node:crypto";

import type { Decision, Signal } from "../models";

const actionBySignal: Record<Signal["type"], { action: string; rationale: string }> = {
  marketing_momentum: {
    action: "increase_growth_output",
    rationale: "Momentum signals should be converted into more output while performance is favorable."
  },
  revenue_opportunity: {
    action: "trigger_revenue_follow_up",
    rationale: "Revenue opportunities decay quickly when not routed into follow-up."
  },
  infrastructure_risk: {
    action: "run_infrastructure_diagnostic",
    rationale: "Infrastructure risk should be investigated before it cascades into customer impact."
  },
  system_anomaly: {
    action: "tighten_autonomy_and_review",
    rationale: "Low-confidence autonomy states require tighter control before more actions execute."
  },
  growth_trend: {
    action: "replicate_high_signal_content",
    rationale: "Repeatable trends should be turned into planned output rather than treated as one-offs."
  },
  automation_backlog: {
    action: "clear_backlog_and_review_failures",
    rationale: "Backlog pressure hides blocked approvals and failed jobs that can distort autonomy decisions."
  }
};

export function decideFromSignals(signals: Signal[]): Decision[] {
  return signals.map((signal) => ({
    id: `dec_${randomUUID()}`,
    signalId: signal.id,
    recommendedAction: actionBySignal[signal.type].action,
    confidence: Math.min(0.99, signal.confidence),
    priority: signal.priority,
    rationale: actionBySignal[signal.type].rationale
  }));
}
