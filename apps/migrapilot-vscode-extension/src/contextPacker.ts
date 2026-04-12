import * as vscode from "vscode";
import * as path from "path";

export interface CompletionContext {
  prefix: string;
  suffix: string;
  languageId: string;
  relativeFilePath: string;
  projectName: string;
  openTabs: string[];
}

const MAX_OPEN_TABS = 20;

export function packCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position
): CompletionContext {
  const cfg = vscode.workspace.getConfiguration("migrapilot");
  const maxPrefixLines = cfg.get<number>("completions.maxPrefixLines", 60);
  const maxSuffixLines = cfg.get<number>("completions.maxSuffixLines", 20);
  const lineCount = document.lineCount;

  // Prefix: up to maxPrefixLines lines before and including the cursor line
  const prefixStartLine = Math.max(0, position.line - maxPrefixLines + 1);
  const prefixRange = new vscode.Range(
    prefixStartLine,
    0,
    position.line,
    position.character
  );
  const prefix = document.getText(prefixRange);

  // Suffix: from cursor to up to maxSuffixLines lines after
  const suffixEndLine = Math.min(lineCount - 1, position.line + maxSuffixLines);
  const suffixRange = new vscode.Range(
    position.line,
    position.character,
    suffixEndLine,
    document.lineAt(suffixEndLine).text.length
  );
  const suffix = document.getText(suffixRange);

  // Relative file path within the first workspace folder
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const relativeFilePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
    : path.basename(document.uri.fsPath);

  // Project name — prefer workspace name, fall back to folder name
  const projectName =
    workspaceFolder?.name ??
    (vscode.workspace.workspaceFolders?.[0]?.name ?? "unknown");

  // Open tabs (file paths only, up to MAX_OPEN_TABS, excluding the current file)
  const currentFsPath = document.uri.fsPath;
  const openTabs = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter(
      (t) =>
        t.input instanceof vscode.TabInputText &&
        t.input.uri.fsPath !== currentFsPath
    )
    .slice(0, MAX_OPEN_TABS)
    .map((t) => {
      const uri = (t.input as vscode.TabInputText).uri;
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      return folder
        ? path.relative(folder.uri.fsPath, uri.fsPath)
        : path.basename(uri.fsPath);
    });

  return {
    prefix,
    suffix,
    languageId: document.languageId,
    relativeFilePath,
    projectName,
    openTabs,
  };
}
