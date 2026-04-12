import { randomUUID } from "node:crypto";

import type { ChatMessage, ToolExecutionRequest } from "../shared/types";
import type { MissionAnalysis } from "../mission/types";
import { buildAnalysisForChat } from "../mission/reasoning";

function inferToolCall(message: string): ToolExecutionRequest | null {
  const lower = message.toLowerCase();

  if (lower.includes("inventory") || lower.includes("tenant") || lower.includes("pod") || lower.includes("domain map")) {
    return {
      toolName: "inventory.tenants.list",
      input: { filter: { classification: "internal", limit: 25, offset: 0 } },
      environment: "prod",
      runnerType: "server",
      operator: { operatorId: "console-operator", role: "owner" },
      autonomyBudgetId: "default"
    };
  }

  if (lower.includes("diff") || lower.includes("changes")) {
    return {
      toolName: "repo.diff",
      input: { staged: false, maxBytes: 262144 },
      environment: "dev",
      runnerType: "local",
      operator: { operatorId: "console-operator", role: "owner" },
      autonomyBudgetId: "default"
    };
  }

  if (lower.includes("status") || lower.includes("git")) {
    return {
      toolName: "repo.status",
      input: {},
      environment: "dev",
      runnerType: "local",
      operator: { operatorId: "console-operator", role: "owner" },
      autonomyBudgetId: "default"
    };
  }

  if (lower.includes("journal") || lower.includes("timeline")) {
    return {
      toolName: "journal.list",
      input: { filter: { limit: 50 } },
      environment: "dev",
      runnerType: "local",
      operator: { operatorId: "console-operator", role: "owner" },
      autonomyBudgetId: "default"
    };
  }

  return null;
}

/** Detect if the user is requesting a mission-level action (investigate, fix, remediate, deploy, etc.) */
function inferMissionRequest(message: string): { goal: string } | null {
  const lower = message.toLowerCase();
  const missionKeywords = [
    "investigate",
    "fix",
    "remediate",
    "resolve",
    "run a mission",
    "create a mission",
    "start a mission",
    "deploy",
    "rollback",
    "restart",
    "diagnose",
    "repair"
  ];
  if (!missionKeywords.some((kw) => lower.includes(kw))) {
    return null;
  }
  // Use the raw message as the goal; trim leading polite prefixes
  const goal = message.replace(/^(please\s+|can you\s+|could you\s+)/i, "").trim();
  return { goal };
}

export function planAssistantReply(message: string): {
  assistant: ChatMessage;
  proposed: Array<{ toolName: string; input: Record<string, unknown> }>;
  missionRequest?: { goal: string; analysis: MissionAnalysis };
} {
  const proposed = inferToolCall(message);
  const missionIntent = inferMissionRequest(message);

  const reply = missionIntent
    ? `I'll create a proposed mission: "${missionIntent.goal}". Review the analysis and execute when ready.`
    : proposed
      ? `Planned next action: ${proposed.toolName}. Review the proposed call and run it from the timeline panel.`
      : "I can plan and execute tools. Ask for inventory, journal, repo status, or diffs and I will propose a call.";

  const missionRequest = missionIntent
    ? { goal: missionIntent.goal, analysis: buildAnalysisForChat({ goal: missionIntent.goal }) }
    : undefined;

  return {
    assistant: {
      id: `msg_${randomUUID()}`,
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString(),
      proposedToolCalls: proposed
        ? [
            {
              toolName: proposed.toolName,
              input: proposed.input
            }
          ]
        : []
    },
    proposed: proposed
      ? [
          {
            toolName: proposed.toolName,
            input: proposed.input
          }
        ]
      : [],
    missionRequest
  };
}
