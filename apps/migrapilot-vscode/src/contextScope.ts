/**
 * Intent-aware context scope (Phase C.7).
 *
 * Until now the extension was a context FORWARDER: if anything was selected, the
 * selection won — always. So "Explain this file in detail" with a stray `for` loop
 * still highlighted returned a review of that one loop, headed "File fragment under
 * review". The operator asked about the FILE and got three lines.
 *
 * A senior engineer resolves scope from what you ASKED, not from where your cursor
 * happens to sit. This module classifies the request, and the collector then sends the
 * region that request is actually about.
 *
 * Pure and vscode-free so it is directly testable.
 */

export type ContextScope = "file" | "selection" | "symbol" | "diagnostics";

export interface ScopeDecision {
  scope: ContextScope;
  /** Why this scope was chosen — surfaced to the model and to tests. */
  reason: string;
}

/**
 * Order matters. Each rule keys off a DIFFERENT noun the operator used, and the more
 * specific noun wins:
 *
 *   "fix this error"        -> the failure       -> diagnostics
 *   "review the selection"  -> what they marked  -> selection
 *   "explain this function" -> a symbol          -> symbol
 *   "review this file"      -> the whole file    -> file      (EVEN IF something is selected)
 *
 * Only when the request names no scope at all do we fall back to the editor's state.
 */
const DIAGNOSTICS_RE =
  /\b(fix|debug|diagnose|resolve)\b[^.?!]*\b(this|the|that|these)\b[^.?!]*\b(error|errors|exception|bug|failure|problem|issue|warning|stack ?trace)\b|\b(this|the)\s+(error|exception|stack ?trace)\b|\bwhy\b[^.?!]*\b(fail|failing|failed|error|throw|throwing|break|breaking|crash)\w*\b|\bwhat'?s wrong\b/i;

const SELECTION_RE =
  /\bselect(?:ion|ed)\b|\bhighlighted\b|\bthese lines\b|\bthis (?:snippet|block|excerpt|chunk)\b|\bthe (?:lines|code) (?:i|I) (?:selected|highlighted)\b/i;

const SYMBOL_RE =
  /\bthis (?:function|method|class|component|hook|handler|constructor|interface|type|enum)\b|\bthe (?:function|method|class|component|hook) (?:above|below|here|under (?:my |the )?cursor)\b|\brefactor this\b|\bthis (?:one|impl(?:ementation)?)\b/i;

const FILE_RE =
  /\b(?:this|the|current|currently open|active|open|whole|entire|full)\s+file\b|\bin this file\b|\bthis (?:module|script|source ?file)\b|\bthe (?:whole|entire) (?:thing|module)\b|\bfile in detail\b/i;

export function classifyContextScope(text: string, hasSelection: boolean): ScopeDecision {
  const t = (text || "").trim();

  if (DIAGNOSTICS_RE.test(t)) {
    return { scope: "diagnostics", reason: "the request is about a failure, so the diagnostics and the code around them are what matter" };
  }
  if (SELECTION_RE.test(t)) {
    return hasSelection
      ? { scope: "selection", reason: "the operator explicitly asked about the selection" }
      : { scope: "file", reason: "the operator asked about a selection but nothing is selected, so the file is sent instead" };
  }
  if (SYMBOL_RE.test(t)) {
    return { scope: "symbol", reason: "the operator asked about a specific symbol, so the enclosing definition is sent" };
  }
  if (FILE_RE.test(t)) {
    // The whole point: an explicit "this file" OVERRIDES a stray selection.
    return { scope: "file", reason: "the operator asked about the file, so the selection is ignored and the whole file is sent" };
  }
  return hasSelection
    ? { scope: "selection", reason: "no scope was named and code is selected, so the selection is what the operator is pointing at" }
    : { scope: "file", reason: "no scope was named and nothing is selected, so the active file is sent" };
}

/** Which fence label pilot-api should see. Unchanged wire vocabulary — no new labels. */
export function fenceKindFor(scope: ContextScope): "file" | "region" {
  return scope === "file" ? "file" : "region";
}
