import * as vscode from "vscode";
import { ContextCollector } from "./contextCollector";
import { createDraftPatchPlan } from "./patchPlanner";
import type { WorkspaceContext } from "./types";
import { WebviewProvider } from "./webviewProvider";

type CommandSpec = {
  id: string;
  prompt: string;
  patchPlan?: boolean;
};

const COMMANDS: CommandSpec[] = [
  { id: "migrapilot.openChat", prompt: "Open MigraPilot chat." },
  { id: "migrapilot.explainCurrentFile", prompt: "Explain the current file using the local read-only file preview." },
  { id: "migrapilot.reviewSelection", prompt: "Review the selected code using the local read-only selection preview. Draft only; no edits." },
  { id: "migrapilot.startAgentTask", prompt: "Draft an agent task plan using local context only. Planning only in Phase 3.", patchPlan: true },
  { id: "migrapilot.openVoiceCommand", prompt: "Open voice command placeholder. Transcript review required before future execution." },
  { id: "migrapilot.openCommandCenter", prompt: "Open Command Center placeholder. Operations locked in Phase 3." },
  { id: "migrapilot.showCurrentContext", prompt: "Show the current workspace, file, and selection context." },
  { id: "migrapilot.captureCurrentContext", prompt: "Captured current editor context." },
];

export class Commands {
  public static registerCommands(
    context: vscode.ExtensionContext,
    webviewProvider: WebviewProvider,
    captureContext?: () => WorkspaceContext
  ): void {
    for (const spec of COMMANDS) {
      const disposable = vscode.commands.registerCommand(spec.id, async () => {
        // Capture before showView(): focusing the webview clears activeTextEditor.
        const workspaceContext = captureContext
          ? captureContext()
          : ContextCollector.collect(vscode.window.activeTextEditor);
        const prompt = buildPrompt(spec.prompt, workspaceContext);
        const patchPlan = spec.patchPlan
          ? createDraftPatchPlan(workspaceContext, spec.prompt)
          : undefined;

        await webviewProvider.showView();
        webviewProvider.postMessage({
          command: spec.id === "migrapilot.showCurrentContext" ? "showCurrentContext" : "appendPrompt",
          prompt,
          context: workspaceContext,
          patchPlan,
        });
      });

      context.subscriptions.push(disposable);
    }
  }
}

function buildPrompt(prompt: string, context: ReturnType<typeof ContextCollector.collect>): string {
  const target = context.hasSelection ? "selected text" : "current file";
  const path = context.relativeFilePath || context.activeFilePath || "no active file";

  return [
    prompt,
    "",
    `Target: ${target}`,
    `File: ${path}`,
    `Language: ${context.languageId || "unknown"}`,
    `Lines: ${context.fileLineCount}`,
    `Selection lines: ${context.selectionLineCount}`,
    context.warning ? `Warning: ${context.warning}` : "",
    "",
    "Do not edit files. Do not run commands. Draft only.",
  ].filter(Boolean).join("\n");
}
