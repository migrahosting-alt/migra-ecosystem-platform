import * as vscode from "vscode";
import { Commands } from "./commands";
import { ContextCollector } from "./contextCollector";
import { WebviewProvider } from "./webviewProvider";
import type { WorkspaceContext } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  console.log("MigraPilot AI Engineer activated");

  const contextCollector = new ContextCollector();
  let capturedContext: WorkspaceContext = contextCollector.collectContext(vscode.window.activeTextEditor);

  const captureCurrentEditorContext = () => {
    capturedContext = contextCollector.collectContext(vscode.window.activeTextEditor);
    return capturedContext;
  };

  const webviewProvider = new WebviewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, webviewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  Commands.registerCommands(context, webviewProvider, captureCurrentEditorContext);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "MigraPilot: Read-only";
  statusBar.tooltip = "MigraPilot Phase 3.5 runs at Action Level 0";
  statusBar.command = "migrapilot.openChat";
  statusBar.show();

  context.subscriptions.push(statusBar, contextCollector);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        capturedContext = contextCollector.collectContext(editor);
        webviewProvider.postCapturedContext(capturedContext);
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      capturedContext = contextCollector.collectContext(event.textEditor);
      webviewProvider.postCapturedContext(capturedContext);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && event.document === activeEditor.document) {
        capturedContext = contextCollector.collectContext(activeEditor);
        webviewProvider.postCapturedContext(capturedContext);
      }
    })
  );
}

export function deactivate(): void {
  // No shutdown work required in Phase 3.5.
}
