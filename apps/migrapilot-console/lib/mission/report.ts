import { executeViaBrainApi } from "./execute-api";
import type { MissionRecord, MissionReport } from "./types";

function extractChangedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  const matches = diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm);
  for (const match of matches) {
    if (match[2]) {
      files.add(match[2]);
    }
  }
  return [...files];
}

async function detectChangedFiles(mission: MissionRecord): Promise<string[]> {
  const diffRun = mission.toolRuns.find((run) => run.toolName === "repo.diff");
  if (!diffRun) {
    return [];
  }

  const diff = await executeViaBrainApi({
    runnerTarget: "local",
    toolName: "repo.diff",
    toolInput: { staged: false, maxBytes: 262144 },
    environment: "dev",
    operator: mission.operator,
    runId: `${mission.runIdBase}_report_diff`
  });

  const diffText =
    diff.result && diff.result.ok && typeof diff.result.data.diff === "string"
      ? diff.result.data.diff
      : "";
  return extractChangedFilesFromDiff(diffText);
}

export async function buildMissionReport(mission: MissionRecord): Promise<MissionReport> {
  const journalEntryIds = Array.from(
    new Set(
      mission.toolRuns
        .map((run) => run.journalEntryId)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  const changedFiles = await detectChangedFiles(mission);

  const patchOccurred = mission.toolRuns.some((run) => run.toolName === "repo.applyPatch" && run.ok);
  const qaPassed = patchOccurred
    ? mission.toolRuns.some((run) => run.toolName === "repo.run" && run.ok)
    : true;

  const checks = patchOccurred
    ? [qaPassed ? "repo.run passed after patch" : "repo.run missing/failed after patch"]
    : ["No patch applied, QA requirement not triggered"];

  const nextActions: string[] = [];
  if (mission.status === "completed") {
    nextActions.push("Open PR with generated commit and diff summary.");
    nextActions.push("Run staging deploy checklist before production rollout.");
  }
  if (mission.status === "awaiting_approval") {
    nextActions.push("Resolve pending approval with humanKeyTurnCode on /approvals.");
  }
  if (mission.status === "failed") {
    nextActions.push("Review failed task logs and rerun /api/mission/step after fixes.");
  }

  const summary = `${mission.status.toUpperCase()}: ${mission.goal}`;
  const taskLines = mission.tasks
    .map((task) => `- [${task.status}] (${task.lane}) ${task.title}`)
    .join("\n");

  const markdown = [
    `# Mission Report: ${mission.missionId}`,
    "",
    `Status: **${mission.status}**`,
    "",
    "## Summary",
    summary,
    "",
    "## Tasks",
    taskLines,
    "",
    "## Verification",
    checks.map((check) => `- ${check}`).join("\n"),
    "",
    "## Changed Files",
    changedFiles.length ? changedFiles.map((file) => `- ${file}`).join("\n") : "- none",
    "",
    "## Journal Entries",
    journalEntryIds.length ? journalEntryIds.map((id) => `- ${id}`).join("\n") : "- none",
    "",
    "## Next Actions",
    nextActions.length ? nextActions.map((item) => `- ${item}`).join("\n") : "- none"
  ].join("\n");

  return {
    missionId: mission.missionId,
    status: mission.status,
    summary,
    tasks: mission.tasks.map((task) => ({
      taskId: task.taskId,
      lane: task.lane,
      title: task.title,
      status: task.status,
      retries: task.retries
    })),
    changedFiles,
    verification: {
      qaPassed,
      checks
    },
    journalEntryIds,
    nextActions,
    markdown
  };
}
