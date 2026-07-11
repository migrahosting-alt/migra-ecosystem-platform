import * as vscode from "vscode";
import type { WorkspaceContext } from "./types";

const MAX_PREVIEW_CHARS = 12000;
const MAX_SELECTION_CHARS = 12000;
const WARNING_SIZE_BYTES = 200000;

/** Filenames/paths whose contents must never be silently swept into chat
 *  context. Env files, private keys, and credential stores are withheld — the
 *  editor still reports the path/language, but never the bytes. */
const SECRET_FILE_PATTERNS: RegExp[] = [
  /\.env(\.[^\\/]+)*$/i,                                   // .env, prod.env, .env.local
  /\.(pem|key|p12|pfx|keystore|jks)$/i,                    // private keys / keystores
  /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,         // ssh keys
  /(^|[\\/])(secrets?|credentials?)(\.[a-z0-9]+)?$/i,      // secrets / credentials files
  /\.(secret|secrets)$/i,
];

export function isSecretLikePath(filePath: string): boolean {
  const p = (filePath || "").trim();
  if (!p) return false;
  return SECRET_FILE_PATTERNS.some((re) => re.test(p));
}

export class ContextCollector {
  public static collect(editor?: vscode.TextEditor): WorkspaceContext {
    return new ContextCollector().collectContext(editor ?? vscode.window.activeTextEditor);
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

      const secret = isSecretLikePath(activeFilePath) || isSecretLikePath(relativeFilePath);
      const fullText = secret ? "" : document.getText();
      fileSizeBytes = Buffer.byteLength(fullText, "utf8");

      if (secret) {
        // Report the file exists, but withhold its bytes entirely.
        filePreview = "";
        selectedTextPreview = "";
        selectedTextLength = 0;
        return {
          workspaceName,
          activeFilePath,
          relativeFilePath,
          languageId,
          hasSelection: false,
          selectionLineCount: 0,
          actionLevel: 0,
          mode: "ask",
          fileSizeBytes: 0,
          fileLineCount,
          filePreview: "",
          selectedTextPreview: "",
          selectedTextLength: 0,
          truncated: false,
          warning: "Secret-like file detected — contents withheld from MigraPilot context.",
        };
      }

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
    // No resources to release in Phase 3.5.
  }
}
