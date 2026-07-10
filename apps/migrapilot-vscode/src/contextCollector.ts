import * as vscode from "vscode";
import type { WorkspaceContext } from "./types";

export class ContextCollector {
  public static collect(): WorkspaceContext {
    return new ContextCollector().collectContext(vscode.window.activeTextEditor);
  }

  public collectContext(editor?: vscode.TextEditor): WorkspaceContext {
    const activeEditor = editor ?? vscode.window.activeTextEditor;
    const workspaceName = vscode.workspace.name ?? "Unknown Workspace";

    let activeFilePath = "";
    let languageId = "";
    let hasSelection = false;
    let selectionLineCount = 0;

    if (activeEditor) {
      activeFilePath = activeEditor.document.fileName;
      languageId = activeEditor.document.languageId;
      hasSelection = !activeEditor.selection.isEmpty;

      if (hasSelection) {
        selectionLineCount =
          Math.abs(activeEditor.selection.end.line - activeEditor.selection.start.line) + 1;
      }
    }

    return {
      workspaceName,
      activeFilePath,
      languageId,
      hasSelection,
      selectionLineCount,
      actionLevel: 0,
      mode: "ask",
    };
  }

  public dispose(): void {
    // No resources to release in Phase 1.
  }
}
