import { describe, it, expect } from "vitest";
import { ContextCollector, isSecretLikePath } from "../../src/contextCollector";
import { toContext } from "../../src/extension";
import { Selection } from "../harness/vscodeMock";

/** Build a fake vscode.TextEditor over an in-memory document. */
function fakeEditor(opts: { path: string; language?: string; text: string; selection?: [number, number, number, number] }): any {
  const uri = { fsPath: opts.path, path: opts.path, toString: () => opts.path };
  const sel = opts.selection ? new Selection(...opts.selection) : new Selection(0, 0, 0, 0);
  const document = {
    fileName: opts.path,
    uri,
    languageId: opts.language ?? "plaintext",
    lineCount: opts.text.split("\n").length,
    getText: (range?: any) => {
      if (!range) return opts.text;
      // return selected slice by line range for the fixture
      const lines = opts.text.split("\n");
      return lines.slice(range.start.line, range.end.line + 1).join("\n");
    },
  };
  return { document, selection: sel };
}

describe("editor context collection (scenarios 13-18)", () => {
  it("S13: active file content is collected into the preview", () => {
    const ed = fakeEditor({ path: "/home/u/workspace/proj/src/a.ts", language: "typescript", text: "export const x = 1;" });
    const ctx = new ContextCollector().collectContext(ed);
    expect(ctx.filePreview).toBe("export const x = 1;");
    expect(ctx.languageId).toBe("typescript");
    expect(ctx.fileLineCount).toBe(1);
  });

  it("S14: selected text is captured and preferred by toContext when present", () => {
    const text = "line0\nline1\nline2\nline3";
    const ed = fakeEditor({ path: "/home/u/workspace/proj/src/b.ts", language: "typescript", text, selection: [1, 0, 2, 5] });
    const ctx = new ContextCollector().collectContext(ed);
    expect(ctx.hasSelection).toBe(true);
    expect(ctx.selectedTextPreview).toBe("line1\nline2");
    const forwarded = toContext(ctx);
    expect(forwarded.selection).toBe("line1\nline2"); // selection preferred over full file
  });

  it("S15: paths are workspace-relative, not absolute", () => {
    const ed = fakeEditor({ path: "/home/u/workspace/proj/src/deep/c.ts", text: "x" });
    const ctx = new ContextCollector().collectContext(ed);
    expect(ctx.relativeFilePath).toBe("proj/src/deep/c.ts");
    expect(ctx.relativeFilePath.startsWith("/")).toBe(false);
  });

  it("S16: missing/untitled editor state is handled cleanly (no throw, empty context)", () => {
    const ctx = new ContextCollector().collectContext(undefined);
    expect(ctx.activeFilePath).toBe("");
    expect(ctx.filePreview).toBe("");
    expect(ctx.hasSelection).toBe(false);
    expect(toContext(ctx).file).toBeUndefined();
  });

  it("S17: large files are truncated/bounded with a warning", () => {
    const big = "a".repeat(20000);
    const ed = fakeEditor({ path: "/home/u/workspace/proj/big.txt", text: big });
    const ctx = new ContextCollector().collectContext(ed);
    expect(ctx.truncated).toBe(true);
    expect(ctx.filePreview.length).toBe(12000);
    expect(ctx.warning).not.toBe("");
  });

  it("S18: secret-like files are NOT read — contents withheld, path still reported", () => {
    for (const p of ["/home/u/workspace/proj/.env", "/home/u/workspace/proj/config/prod.env", "/home/u/workspace/proj/certs/server.pem", "/home/u/workspace/proj/id_rsa"]) {
      expect(isSecretLikePath(p)).toBe(true);
      const ed = fakeEditor({ path: p, text: "SECRET_KEY=super-secret-value" });
      const ctx = new ContextCollector().collectContext(ed);
      expect(ctx.filePreview).toBe("");
      expect(ctx.selectedTextPreview).toBe("");
      expect(ctx.warning).toMatch(/withheld/i);
      // path/existence still surfaced so the model knows the file is there
      expect(ctx.activeFilePath).toBe(p);
    }
    // a normal source file is unaffected
    expect(isSecretLikePath("/home/u/workspace/proj/src/index.ts")).toBe(false);
  });
});
