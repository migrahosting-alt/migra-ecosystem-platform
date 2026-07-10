import * as vscode from "vscode";
import { ContextCollector } from "./contextCollector";
import { WebviewProvider } from "./webviewProvider";

type CommandSpec = {
  id: string;
  prompt: string;
};

const COMMANDS: CommandSpec[] = [
  { id: "migrapilot.openChat", prompt: "Open MigraPilot chat." },
  { id: "migrapilot.explainCurrentFile", prompt: "Explain the current file using local context only." },
  { id: "migrapilot.reviewSelection", prompt: "Review the selected code. Draft only; no edits." },
  { id: "migrapilot.startAgentTask", prompt: "Start an agent task draft. Planning only in Phase 1." },
  { id: "migrapilot.openVoiceCommand", prompt: "Open voice command placeholder. Transcript review required before future execution." },
  { id: "migrapilot.openCommandCenter", prompt: "Open Command Center placeholder. Operations locked in Phase 1." },
  { id: "migrapilot.showCurrentContext", prompt: "Show the current workspace context." },
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
          prompt: spec.prompt,
          context: workspaceContext,
        });
      });

      context.subscriptions.push(disposable);
    }
  }
}
