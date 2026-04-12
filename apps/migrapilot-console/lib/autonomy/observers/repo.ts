import { executeViaBrainApi } from "../../mission/execute-api";
import { createFinding } from "../finding";
import { TEMPLATE_REPO_LARGE_DIFF_REVIEW } from "../templates";
import type { Finding, ObserverContext } from "../types";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function repoObserver(context: ObserverContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const runIdBase = `autonomy_repo_${context.now.getTime()}`;

  const status = await executeViaBrainApi({
    runnerTarget: "local",
    toolName: "repo.status",
    toolInput: {},
    environment: "dev",
    operator: {
      operatorId: "autonomy-observer",
      role: "ops"
    },
    runId: `${runIdBase}_status`,
    autonomyBudgetId: "autonomy-observe"
  });

  if (!status.result?.ok) {
    findings.push(
      createFinding({
        source: "repo",
        severity: "warn",
        title: "Repo observer could not read git status",
        details: status.result?.error?.message ?? "repo.status failed",
        suggestedMissionTemplateId: TEMPLATE_REPO_LARGE_DIFF_REVIEW
      })
    );
    return findings;
  }

  const statusData = asRecord(status.result.data);
  const clean = Boolean(statusData.clean);
  const branch = typeof statusData.branch === "string" ? statusData.branch : "unknown";
  const statusLines = Array.isArray(statusData.statusLines)
    ? statusData.statusLines.filter((line): line is string => typeof line === "string")
    : [];

  if (!clean) {
    findings.push(
      createFinding({
        source: "repo",
        severity: statusLines.length > 40 ? "critical" : "warn",
        title: `Repository has ${statusLines.length} uncommitted changes on ${branch}`,
        details: statusLines.slice(0, 20).join("\n") || "Repository dirty",
        suggestedMissionTemplateId: TEMPLATE_REPO_LARGE_DIFF_REVIEW
      })
    );
  }

  return findings;
}
