import * as vscode from "vscode";
import { ContextCollector } from "./contextCollector";
import { WebviewProvider } from "./webviewProvider";

type CommandSpec = {
  id: string;
  prompt: string;
};

const COMMANDS: CommandSpec[] = [
  { id: "migrapilot.openChat", prompt: "Open MigraPilot chat." },
  { id: "migrapilot.explainCurrentFile", prompt: "Explain the current file using the local read-only file preview." },
  { id: "migrapilot.reviewSelection", prompt: "Review the selected code using the local read-only selection preview. Draft only; no edits." },
  { id: "migrapilot.startAgentTask", prompt: "Draft an agent task plan using local context only. Planning only in Phase 2." },
  { id: "migrapilot.openVoiceCommand", prompt: "Open voice command placeholder. Transcript review required before future execution." },
  { id: "migrapilot.openCommandCenter", prompt: "Open Command Center placeholder. Operations locked in Phase 2." },
  { id: "migrapilot.showCurrentContext", prompt: "Show the current workspace, file, and selection context." },
];

export class Commands {
  public static registerCommands(
    context: vscode.ExtensionContext,
    webviewProvider: WebviewProvider
  ): void {
    for (const spec of COMMANDS) {
      const disposable = vscode.commands.registerCommand(spec.id, () => {
        const workspaceContext = ContextCollector.collect();
        webviewProvider.showView();
        webviewProvider.postMessage({
          command: spec.id === "migrapilot.showCurrentContext" ? "showCurrentContext" : "appendPrompt",
          prompt: buildPrompt(spec.prompt, workspaceContext),
          context: workspaceContext,
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
