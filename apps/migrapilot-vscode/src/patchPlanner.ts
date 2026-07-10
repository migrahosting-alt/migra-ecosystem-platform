import type { DraftPatchPlan, WorkspaceContext } from "./types";

const TEST_HINTS: Record<string, string[]> = {
  typescript: ["npm run compile", "npm test"],
  javascript: ["npm test"],
  json: ["python3 -m json.tool <file>"],
  markdown: ["markdown lint/review manually"],
};

export function createDraftPatchPlan(context: WorkspaceContext, intent: string): DraftPatchPlan {
  const relativePath = context.relativeFilePath || context.activeFilePath || "No active file";
  const target = context.hasSelection ? "selected code" : "current file";
  const language = context.languageId || "unknown";

  const proposedChanges = [
    "Inspect the local context shown in MigraPilot.",
    context.hasSelection
      ? "Focus the patch plan on the selected text only unless surrounding code is required."
      : "Focus the patch plan on the active file only unless related files are explicitly identified.",
    "Identify the smallest safe change that would address the request.",
    "List verification steps for the operator to run manually.",
    "Do not apply edits automatically in Phase 3.",
  ];

  const riskLevel = inferRiskLevel(context, intent);
  const commands = TEST_HINTS[language] ?? ["run the project-specific compile/test command manually"];

  return {
    title: "Draft Patch Plan",
    problemSummary: buildProblemSummary(context, intent),
    targetScope: `${target} in ${relativePath}`,
    filesLikelyInvolved: [relativePath],
    proposedChanges,
    riskLevel,
    manualVerificationCommands: commands,
    rollbackNotes: [
      "Do not apply changes automatically.",
      "If a future manual patch causes issues, revert the specific file changes with git checkout or a reviewed reverse patch.",
      "Keep production/deploy actions out of this phase.",
    ],
    safetyBoundary:
      "Draft only. No file writes, no command execution, no shell access, no backend calls, no deploys.",
  };
}

function buildProblemSummary(context: WorkspaceContext, intent: string): string {
  const path = context.relativeFilePath || context.activeFilePath || "no active file";
  const selection = context.hasSelection
    ? `Selection is active (${context.selectionLineCount} lines, ${context.selectedTextLength} chars).`
    : "No selection is active.";

  return `${intent} Target file: ${path}. Language: ${context.languageId || "unknown"}. ${selection}`;
}

function inferRiskLevel(context: WorkspaceContext, intent: string): "low" | "medium" | "high" {
  const text = `${intent} ${context.relativeFilePath} ${context.activeFilePath}`.toLowerCase();

  if (
    text.includes("auth") ||
    text.includes("security") ||
    text.includes("payment") ||
    text.includes("billing") ||
    text.includes("deploy") ||
    text.includes("migration") ||
    text.includes("database") ||
    text.includes("route.ts")
  ) {
    return "high";
  }

  if (context.fileSizeBytes > 100000 || context.truncated) {
    return "medium";
  }

  return "low";
}
