/**
 * E-CTX-01 — active-file truncation caused false syntax diagnostics.
 *
 * Reproduction (manual smoke): open a 287 KB package-lock.json, ask for a review.
 * The extension cut the buffer mid-file and labelled it `File (truncated):` with no
 * indication of HOW MUCH was missing — in fact it labelled COMPLETE files the same
 * way. The model, holding a JSON document that stopped mid-token with unbalanced
 * braces, correctly concluded "this JSON is malformed" — a sound inference from a
 * corrupted premise. `npm ci` and JSON.parse both prove the file is valid.
 *
 * The defect was never in the model or the review engine. It was that the extension
 * DESTROYED the truncation facts it had already computed: ContextCollector produced
 * `truncated`, `fileSizeBytes` and `fileLineCount`, and buildBackendMessage threw
 * them away — then truncated a second time, 12,000 -> 1,800 chars (0.6% of the file).
 *
 * These tests pin the contract: the model is always TOLD what it is holding.
 */

import { describe, it, expect } from "vitest";
import { buildBackendMessage, renderEditorContext } from "../../src/extension";
import { sliceAtLineBoundary } from "../../src/contextCollector";
import type { WorkspaceContext } from "../../src/types";

const MAX_PREVIEW_CHARS = 12000;

function ctx(over: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    workspaceName: "ws",
    activeFilePath: "/repo/src/cart/total.ts",
    relativeFilePath: "src/cart/total.ts",
    languageId: "typescript",
    hasSelection: false,
    selectionLineCount: 0,
    actionLevel: 0,
    mode: "ask",
    fileSizeBytes: 0,
    fileLineCount: 0,
    filePreview: "",
    selectedTextPreview: "",
    selectedTextLength: 0,
    truncated: false,
    warning: "",
    filePreviewTruncated: false,
    selectionTruncated: false,
    fileCharCount: 0,
    ...over,
  };
}

/** A real package-lock.json, cut mid-token exactly the way the collector cuts it. */
function lockfile(): { full: string; preview: string } {
  const entry = (n: number) =>
    `    "node_modules/@esbuild/pkg-${n}": {\n      "version": "0.21.${n}",\n      "resolved": "https://registry.npmjs.org/pkg-${n}",\n      "integrity": "sha512-abcdefghijklmnop==",\n      "dev": true,\n      "optional": true\n    },\n`;
  let full = `{\n  "name": "migrapilot-vscode",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n`;
  for (let i = 0; i < 400; i++) full += entry(i);
  full += `    "node_modules/zod": {\n      "version": "3.23.8"\n    }\n  }\n}\n`;
  return { full, preview: full.slice(0, MAX_PREVIEW_CHARS) };
}

describe("E-CTX-01 — truncated file is declared as truncated", () => {
  const { full, preview } = lockfile();
  const lockCtx = ctx({
    activeFilePath: "/repo/package-lock.json",
    relativeFilePath: "package-lock.json",
    languageId: "json",
    filePreview: preview,
    filePreviewTruncated: true,
    truncated: true,
    fileCharCount: full.length,
    fileSizeBytes: full.length,
    fileLineCount: full.split("\n").length,
  });

  it("the excerpt really is structurally invalid on its own — this is the trap", () => {
    expect(() => JSON.parse(full)).not.toThrow(); // the FILE is valid…
    expect(() => JSON.parse(preview)).toThrow(); // …the EXCERPT cannot parse.
  });

  it("declares the truncation, the true size, and that the cut is mid-file", () => {
    const msg = buildBackendMessage("Review this file.", lockCtx, []);
    expect(msg).toContain("TRUNCATED EXCERPT");
    expect(msg).toContain("MID-FILE");
    expect(msg).toMatch(/first 12,000 of [\d,]+ characters/);
    expect(msg).toContain(full.length.toLocaleString("en-US")); // the REAL size is stated
  });

  it("pre-empts the exact false conclusion the model reached", () => {
    const msg = buildBackendMessage("Review this file.", lockCtx, []);
    expect(msg).toMatch(/artifact of the cut, NOT a defect in the file/i);
  });

  it("does NOT truncate a second time — the model sees the full 12,000-char budget", () => {
    const msg = buildBackendMessage("Review this file.", lockCtx, []);
    const fence = /```json\n([\s\S]*?)```/.exec(msg)![1];
    expect(fence.length).toBeGreaterThan(11_000); // old code shipped 1,800
    expect(msg).not.toContain("… (truncated)"); // the old, uninformative marker
  });
});

describe("a complete file is declared COMPLETE (the old code called it truncated)", () => {
  const src = 'export const a = 1;\nexport const b = 2;\n';
  const c = ctx({ filePreview: src, fileCharCount: src.length, fileLineCount: 3 });

  it("labels it complete and never claims truncation", () => {
    const msg = buildBackendMessage("Review this file.", c, []);
    expect(msg).toContain("the COMPLETE file");
    expect(msg).toContain("Nothing was omitted");
    expect(msg).toContain("File (complete):");
    expect(msg).not.toContain("TRUNCATED");
    expect(msg).not.toContain("File (truncated):");
  });

  it("ships the file verbatim, byte for byte", () => {
    const msg = buildBackendMessage("Review this file.", c, []);
    expect(/```typescript\n([\s\S]*?)```/.exec(msg)![1]).toBe(src + "\n");
  });
});

describe("selections", () => {
  it("a complete selection is declared complete and wins over the file", () => {
    const msg = buildBackendMessage(
      "Review this.",
      ctx({
        hasSelection: true,
        selectedTextPreview: 'if (user.role == "admin") { grant(); }',
        selectedTextLength: 38,
        selectionLineCount: 1,
        filePreview: "the whole file",
        fileCharCount: 14,
      }),
      [],
    );
    expect(msg).toContain("Selected code:");
    expect(msg).toContain("complete selection");
    expect(msg).not.toContain("the whole file");
    expect(msg).not.toContain("TRUNCATED");
  });

  it("a truncated selection says so, with the true selected length", () => {
    const msg = buildBackendMessage(
      "Review this.",
      ctx({
        hasSelection: true,
        selectedTextPreview: "x".repeat(MAX_PREVIEW_CHARS),
        selectedTextLength: 40_000,
        selectionTruncated: true,
        truncated: true,
      }),
      [],
    );
    expect(msg).toContain("TRUNCATED SELECTION");
    expect(msg).toContain("40,000");
    expect(msg).toContain("NOT sent");
  });
});

describe("wire contract with pilot-api parseEditorContext", () => {
  const HEADER = /---\s*Editor context\s*---\s*\r?\nFile:\s*([^\r\n(]+?)\s*(?:\(([^)\r\n]+)\))?\s*\r?\n/;

  it("the header pilot-api greps for still matches, truncated or not", () => {
    for (const c of [
      ctx({ filePreview: "a", fileCharCount: 1 }),
      ctx({ filePreview: "a".repeat(MAX_PREVIEW_CHARS), filePreviewTruncated: true, fileCharCount: 99_999 }),
    ]) {
      const m = HEADER.exec(buildBackendMessage("Review.", c, []));
      expect(m).not.toBeNull();
      expect(m![1]).toBe("src/cart/total.ts");
      expect(m![2]).toBe("typescript");
    }
  });

  it("emits exactly one of the three fence labels pilot-api knows", () => {
    const labels = (m: string) =>
      ["Selected code:", "File (complete):", "File (truncated):"].filter((l) => m.includes(l));
    expect(labels(buildBackendMessage("r", ctx({ filePreview: "a", fileCharCount: 1 }), []))).toEqual([
      "File (complete):",
    ]);
    expect(
      labels(
        buildBackendMessage("r", ctx({ filePreview: "a", filePreviewTruncated: true, fileCharCount: 9 }), []),
      ),
    ).toEqual(["File (truncated):"]);
    expect(
      labels(
        buildBackendMessage(
          "r",
          ctx({ hasSelection: true, selectedTextPreview: "s", selectedTextLength: 1 }),
          [],
        ),
      ),
    ).toEqual(["Selected code:"]);
  });
});

describe("degenerate inputs", () => {
  it("no active file emits no editor context at all", () => {
    const msg = buildBackendMessage("hi", ctx({ activeFilePath: "", relativeFilePath: "" }), []);
    expect(msg).toBe("hi");
    expect(renderEditorContext(ctx({ activeFilePath: "", relativeFilePath: "" }))).toBe("");
  });

  it("a withheld secret file contributes a header but no code and no false claims", () => {
    const msg = buildBackendMessage(
      "Review this.",
      ctx({ relativeFilePath: ".env", languageId: "dotenv", filePreview: "" }),
      [],
    );
    expect(msg).toContain("File: .env");
    expect(msg).not.toContain("```");
    expect(msg).not.toContain("COMPLETE");
    expect(msg).not.toContain("TRUNCATED");
  });
});

/**
 * E-CTX-01b — a mid-token cut manufactures a defect that isn't there.
 *
 * With the truncation declared, the model stopped claiming the FILE was malformed —
 * but it still flagged the half-written last line as a "Malformed JSON fragment ...
 * the key is present without a colon/value, which makes the JSON invalid EVEN BEFORE
 * the file cut-off". Sound reasoning; the premise was manufactured by our own slice().
 * Cutting at a line boundary removes the artifact instead of arguing with it.
 */
describe("E-CTX-01b — the cut never lands mid-token", () => {
  it("drops the partial trailing line", () => {
    const text = "line one\nline two\nline three is long";
    const cut = sliceAtLineBoundary(text, 20); // lands inside "line three is long"
    expect(cut).toBe("line one\nline two");
    expect(cut.endsWith("line")).toBe(false);
  });

  it("returns the text untouched when it fits", () => {
    expect(sliceAtLineBoundary("short", 100)).toBe("short");
  });

  it("falls back to a hard cut when one line exceeds the whole budget", () => {
    const oneLine = "x".repeat(500);
    expect(sliceAtLineBoundary(oneLine, 100)).toHaveLength(100); // no boundary exists
  });

  it("the lockfile excerpt now ends on a WHOLE line — no dangling key", () => {
    const { full } = lockfile();
    const cut = sliceAtLineBoundary(full, MAX_PREVIEW_CHARS);
    const last = cut.split("\n").pop()!;
    expect(cut.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS);
    // The exact failure: the old slice ended on `      "dev` — a key with no colon.
    expect(last).not.toMatch(/"[a-z]+$/);
    expect(last.trim()).toMatch(/[,{}\[\]]$|":\s.+$/); // a complete JSON line
    // and every line the model sees is one the file really contains
    for (const line of cut.split("\n")) expect(full).toContain(line);
  });

  it("the message declares the cut is line-aligned", () => {
    const { full, preview } = lockfile();
    const msg = buildBackendMessage("Review this file.", ctx({
      relativeFilePath: "package-lock.json", languageId: "json",
      filePreview: sliceAtLineBoundary(full, MAX_PREVIEW_CHARS),
      filePreviewTruncated: true, fileCharCount: full.length,
      fileLineCount: full.split("\n").length,
    }), []);
    expect(msg).toContain("cut at a LINE BOUNDARY");
    expect(msg).toContain("every line shown is whole");
    void preview;
  });
});
