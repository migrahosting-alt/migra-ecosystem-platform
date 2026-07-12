import * as vscode from "vscode";
import type { WorkspaceContext } from "./types";
import type { ContextScope } from "./contextScope";

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

/**
 * Cut at a LINE BOUNDARY, never mid-token.
 *
 * A raw `slice(0, N)` lands in the middle of whatever happens to be at offset N —
 * `      "dev` — and the model cannot distinguish that half-written line from a real
 * defect. It reported exactly this as a "Malformed JSON fragment ... the key is present
 * without a colon/value, which makes the JSON invalid EVEN BEFORE the file cut-off":
 * sound reasoning, wrong premise. Telling the model "this is truncated" is not enough,
 * because the corruption looks like it sits BEFORE the cut. So don't manufacture it:
 * drop the partial trailing line and hand over only whole lines.
 */
export function sliceAtLineBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const lastNewline = head.lastIndexOf("\n");
  // A single line longer than the whole budget has no boundary to fall back to.
  return lastNewline > 0 ? head.slice(0, lastNewline) : head;
}

/** The region the request is actually about, resolved from the classified scope. */
export interface ResolvedScope {
  scope: ContextScope;
  reason: string;
  /** Human description of the region, e.g. "the enclosing function `cartTotal` (lines 3-9)". */
  label: string;
  code: string;
  truncated: boolean;
  /** True length of the region before any cut. */
  totalChars: number;
  totalLines: number;
  startLine: number; // 1-based, inclusive
  endLine: number;
  /** Rendered diagnostics for the `diagnostics` scope. */
  diagnostics: string[];
}

const SEVERITY = ["Error", "Warning", "Info", "Hint"];

/**
 * Resolve the region for a scope. Async because the document-symbol provider is.
 *
 * Degrades honestly: if no symbol provider answers (or the cursor sits outside every
 * symbol), a `symbol` request falls back to the file rather than inventing a range.
 */
export async function resolveScope(
  editor: vscode.TextEditor,
  decision: { scope: ContextScope; reason: string },
): Promise<ResolvedScope> {
  const doc = editor.document;
  const fullText = doc.getText();
  let { scope } = decision;
  let reason = decision.reason;

  let startLine = 1;
  let endLine = doc.lineCount;
  let raw = fullText;
  let label = "";
  let diagnostics: string[] = [];

  if (scope === "selection" && !editor.selection.isEmpty) {
    raw = doc.getText(editor.selection);
    startLine = editor.selection.start.line + 1;
    endLine = editor.selection.end.line + 1;
    label = `the operator's selection (lines ${startLine}-${endLine})`;
  } else if (scope === "symbol" || scope === "diagnostics") {
    const range = await enclosingSymbolRange(doc, editor.selection.active);
    if (range) {
      raw = doc.getText(range.range);
      startLine = range.range.start.line + 1;
      endLine = range.range.end.line + 1;
      label =
        scope === "symbol"
          ? `the enclosing ${range.kind} \`${range.name}\` (lines ${startLine}-${endLine})`
          : `the code around the reported problem — ${range.kind} \`${range.name}\` (lines ${startLine}-${endLine})`;
    } else {
      // No symbol provider / cursor outside every symbol: say so, send the file.
      scope = "file";
      reason = `${reason}, but no enclosing symbol could be resolved, so the whole file is sent instead`;
      raw = fullText;
    }
    if (decision.scope === "diagnostics") {
      diagnostics = vscode.languages
        .getDiagnostics(doc.uri)
        .filter((d) => !range || d.range.intersection(range.range))
        .slice(0, 20)
        .map(
          (d) =>
            `${SEVERITY[d.severity] ?? "Info"} line ${d.range.start.line + 1}: ${d.message}` +
            (d.source ? ` (${d.source})` : ""),
        );
    }
  } else {
    scope = "file";
    raw = fullText;
  }

  if (!label) label = scope === "file" ? "the whole file" : "the requested region";

  const totalChars = raw.length;
  const totalLines = raw.split("\n").length;
  const max = scope === "file" ? MAX_PREVIEW_CHARS : MAX_SELECTION_CHARS;
  const code = sliceAtLineBoundary(raw, max);

  return {
    scope,
    reason,
    label,
    code,
    truncated: code.length < totalChars,
    totalChars,
    totalLines,
    startLine,
    endLine,
    diagnostics,
  };
}

/** Innermost document symbol containing the cursor. Null when nothing answers. */
async function enclosingSymbolRange(
  doc: vscode.TextDocument,
  at: vscode.Position,
): Promise<{ range: vscode.Range; name: string; kind: string } | null> {
  let symbols: vscode.DocumentSymbol[] | undefined;
  try {
    symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      doc.uri,
    );
  } catch {
    return null;
  }
  if (!symbols?.length) return null;

  let best: vscode.DocumentSymbol | null = null;
  const walk = (nodes: vscode.DocumentSymbol[]) => {
    for (const n of nodes) {
      if (n.range.contains(at)) {
        best = n; // deeper match overwrites shallower — we want the innermost
        if (n.children?.length) walk(n.children);
      }
    }
  };
  walk(symbols);
  if (!best) return null;
  const b = best as vscode.DocumentSymbol;
  return { range: b.range, name: b.name, kind: (vscode.SymbolKind[b.kind] ?? "symbol").toLowerCase() };
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
    let filePreviewTruncated = false;
    let selectionTruncated = false;
    let fileCharCount = 0;

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
      fileCharCount = fullText.length;

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
          filePreviewTruncated: false,
          selectionTruncated: false,
          fileCharCount: 0,
        };
      }

      if (fullText.length > MAX_PREVIEW_CHARS) {
        filePreview = sliceAtLineBoundary(fullText, MAX_PREVIEW_CHARS);
        filePreviewTruncated = true;
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
          selectedTextPreview = sliceAtLineBoundary(selectedText, MAX_SELECTION_CHARS);
          selectionTruncated = true;
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
      filePreviewTruncated,
      selectionTruncated,
      fileCharCount,
    };
  }

  public dispose(): void {
    // No resources to release in Phase 3.5.
  }
}
