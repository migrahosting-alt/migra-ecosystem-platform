import * as vscode from "vscode";
import { Commands } from "./commands";
import { ContextCollector } from "./contextCollector";
import { WebviewProvider } from "./webviewProvider";

export function activate(context: vscode.ExtensionContext): void {
  console.log("MigraPilot AI Engineer activated");

  const webviewProvider = new WebviewProvider(context.extensionUri);
  const contextCollector = new ContextCollector();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, webviewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  Commands.registerCommands(context, webviewProvider);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "MigraPilot: Read-only";
  statusBar.tooltip = "MigraPilot Phase 2 runs at Action Level 0";
  statusBar.command = "migrapilot.openChat";
  statusBar.show();

  context.subscriptions.push(statusBar, contextCollector);

  const postContext = () => {
    webviewProvider.postMessage({
      command: "contextUpdate",
      context: contextCollector.collectContext(vscode.window.activeTextEditor),
    });
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => postContext()),
    vscode.window.onDidChangeTextEditorSelection(() => postContext()),
    vscode.workspace.onDidChangeTextDocument(() => postContext())
  );

  postContext();
}

export function deactivate(): void {
  // No shutdown work required in Phase 2.
}
