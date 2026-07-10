import * as vscode from "vscode";
import type { WorkspaceContext } from "./types";

const MAX_PREVIEW_CHARS = 12000;
const MAX_SELECTION_CHARS = 12000;
const WARNING_SIZE_BYTES = 200000;

export class ContextCollector {
  public static collect(): WorkspaceContext {
    return new ContextCollector().collectContext(vscode.window.activeTextEditor);
  }

  public collectContext(editor?: vscode.TextEditor): WorkspaceContext {
    const activeEditor = editor ?? vscode.window.activeTextEditor;
    const workspaceName = vscode.workspace.name ?? "Unknown Workspace";

    let activeFilePath = "";
    let relativeFilePath = "";
    let languageId = "";
    let hasSelection = false;
    let selectionLineCount = 0;
    let fileSizeBytes = 0;
    let fileLineCount = 0;
    let filePreview = "";
    let selectedTextPreview = "";
    let selectedTextLength = 0;
    let truncated = false;
    let warning = "";

    if (activeEditor) {
      const document = activeEditor.document;
      activeFilePath = document.fileName;
      relativeFilePath = vscode.workspace.asRelativePath(document.uri, false);
      languageId = document.languageId;
      fileLineCount = document.lineCount;
      hasSelection = !activeEditor.selection.isEmpty;

      const fullText = document.getText();
      fileSizeBytes = Buffer.byteLength(fullText, "utf8");

      if (fullText.length > MAX_PREVIEW_CHARS) {
        filePreview = fullText.slice(0, MAX_PREVIEW_CHARS);
        truncated = true;
      } else {
        filePreview = fullText;
      }

      if (hasSelection) {
        const selectedText = document.getText(activeEditor.selection);
        selectedTextLength = selectedText.length;
        selectionLineCount =
          Math.abs(activeEditor.selection.end.line - activeEditor.selection.start.line) + 1;

        if (selectedText.length > MAX_SELECTION_CHARS) {
          selectedTextPreview = selectedText.slice(0, MAX_SELECTION_CHARS);
          truncated = true;
        } else {
          selectedTextPreview = selectedText;
        }
      }

      if (fileSizeBytes > WARNING_SIZE_BYTES) {
        warning = "Large file detected. MigraPilot is showing a truncated local preview only.";
      } else if (truncated) {
        warning = "Context truncated for safe local preview.";
      }
    }

    return {
      workspaceName,
      activeFilePath,
      relativeFilePath,
      languageId,
      hasSelection,
      selectionLineCount,
      actionLevel: 0,
      mode: "ask",
      fileSizeBytes,
      fileLineCount,
      filePreview,
      selectedTextPreview,
      selectedTextLength,
      truncated,
      warning,
    };
  }

  public dispose(): void {
    // No resources to release in Phase 2.
  }
}
