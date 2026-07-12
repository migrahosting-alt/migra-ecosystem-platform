/**
 * Phase C.7 — intent-aware context scope.
 *
 * Reported from the smoke: with a stray `for` loop still highlighted, the prompt
 *
 *   "Explain this file in detail..."
 *
 * came back headed **"File fragment under review"** and discussed only
 *
 *   for (let i = 0; i <= items.length; i++)
 *
 * The extension was a context FORWARDER: if anything was selected, the selection won,
 * unconditionally — and the server prompt reinforced it ("If a SELECTION is present,
 * review the SELECTION"). The operator asked about the FILE and got three lines.
 *
 * Scope now comes from what they ASKED, not from where the cursor happens to sit.
 */

import { describe, it, expect } from "vitest";
import { classifyContextScope } from "../../src/contextScope";
import { renderScopedContext } from "../../src/extension";

const withSel = (t: string) => classifyContextScope(t, true);
const noSel = (t: string) => classifyContextScope(t, false);

describe("the reported bug: 'this file' must override a stray selection", () => {
  it.each([
    "Explain this file in detail",
    "Explain this file in detail, including what each function does.",
    "Review this file",
    "Find bugs in this file",
    "review the currently open file and find bugs",
    "What does the current file do?",
    "Explain the whole file",
    "Are there any issues in this file?",
  ])("%s -> file (selection ignored)", (prompt) => {
    expect(withSel(prompt).scope).toBe("file");
  });

  it("says WHY it ignored the selection", () => {
    expect(withSel("Explain this file in detail").reason).toMatch(/selection is ignored/i);
  });
});

describe("the operator's scope table", () => {
  it.each([
    ["Explain this file", true, "file"],
    ["Review this file", true, "file"],
    ["Find bugs in this file", true, "file"],
    ["Explain this function", true, "symbol"],
    ["Refactor this method", true, "symbol"],
    ["Review the selection", true, "selection"],
    ["Explain these lines", true, "selection"],
    ["Review the selected code.", true, "selection"],
    ["Fix this error", true, "diagnostics"],
    ["Why is this failing?", true, "diagnostics"],
    ["What's wrong here?", true, "diagnostics"],
  ] as const)("%s -> %s", (prompt, sel, expected) => {
    expect(classifyContextScope(prompt, sel).scope).toBe(expected);
  });
});

describe("fallbacks when the request names no scope", () => {
  it("selection wins when something is selected (the old default, preserved)", () => {
    expect(withSel("what does this do?").scope).toBe("selection");
  });
  it("file when nothing is selected", () => {
    expect(noSel("what does this do?").scope).toBe("file");
  });
  it("asking about a selection with nothing selected falls back to the file, honestly", () => {
    const d = noSel("review the selection");
    expect(d.scope).toBe("file");
    expect(d.reason).toMatch(/nothing is selected/i);
  });
});

describe("the registered commands still route correctly", () => {
  it("migrapilot.explainCurrentFile -> file, even with a selection", () => {
    expect(withSel("Explain the current file.").scope).toBe("file");
  });
  it("migrapilot.reviewSelection -> selection", () => {
    expect(withSel("Review the selected code.").scope).toBe("selection");
  });
});

describe("renderScopedContext — the wire", () => {
  const region = {
    scope: "file", reason: "the operator asked about the file, so the selection is ignored and the whole file is sent",
    label: "the whole file", code: "export const a = 1;\nexport const b = 2;",
    truncated: false, totalChars: 40, totalLines: 2, diagnostics: [] as string[],
  };

  it("states the resolved scope and why", () => {
    const m = renderScopedContext("src/cart/total.ts", "typescript", region);
    expect(m).toContain("Scope: the whole file — the operator asked about the file");
    expect(m).toContain("File (complete):");
    expect(m).toContain("COMPLETE — all 40 characters");
  });

  it("truncation is stated as ARITHMETIC, not as a broken file", () => {
    const m = renderScopedContext("package-lock.json", "json", {
      ...region, code: "x".repeat(12000), truncated: true, totalChars: 46897, totalLines: 900,
    });
    expect(m).toContain("you were sent the first 12,000 of 46,897 characters");
    expect(m).toContain("The remaining 34,897 characters were NOT transmitted");
    expect(m).toContain("findings apply ONLY to the transmitted portion");
    expect(m).toContain("The file itself is intact — it is NOT incomplete.");
    expect(m).not.toContain("excerpt ends"); // the wording that read as "the file is broken"
  });

  it("a narrower scope uses the region fence, so pilot-api reviews only that region", () => {
    const m = renderScopedContext("src/cart/total.ts", "typescript", {
      ...region, scope: "symbol", label: "the enclosing function `cartTotal` (lines 1-9)",
    });
    expect(m).toContain("Selected code:");
    expect(m).not.toContain("File (complete):");
    expect(m).toContain("the enclosing function `cartTotal`");
  });

  it("diagnostics scope ships the reported problems", () => {
    const m = renderScopedContext("src/cart/total.ts", "typescript", {
      ...region, scope: "diagnostics",
      diagnostics: ["Error line 3: Object is possibly 'undefined'. (ts)"],
    });
    expect(m).toContain("Reported problems (1):");
    expect(m).toContain("Object is possibly 'undefined'.");
  });

  it("uses only fence labels pilot-api already knows — no new wire vocabulary", () => {
    const labels = ["Selected code:", "File (complete):", "File (truncated):"];
    for (const scope of ["file", "selection", "symbol", "diagnostics"]) {
      const m = renderScopedContext("a.ts", "typescript", { ...region, scope });
      expect(labels.filter((l) => m.includes(l))).toHaveLength(1);
    }
  });
});
