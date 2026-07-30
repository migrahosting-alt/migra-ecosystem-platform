import { describe, it, expect } from "vitest";
import { classifyAttachment, buildBackendMessage, MAX_ATTACHMENT_BYTES, Attachment } from "../../src/extension";
import type { WorkspaceContext } from "../../src/types";

const emptyCtx: WorkspaceContext = {
  workspaceName: "w", activeFilePath: "", relativeFilePath: "", languageId: "",
  hasSelection: false, selectionLineCount: 0, actionLevel: 0, mode: "ask",
  fileSizeBytes: 0, fileLineCount: 0, filePreview: "", selectedTextPreview: "",
  selectedTextLength: 0, truncated: false, warning: "",
};

describe("attachment validation & injection (scenarios 19-24)", () => {
  it("S19: an allowed text/code file is accepted and reaches the backend message", () => {
    const verdict = classifyAttachment({ fileName: "util.ts", ext: ".ts", byteLength: 500, relativePath: "src/util.ts" });
    expect(verdict).toEqual({ ok: true, kind: "text" });
    const att: Attachment = { id: "a1", label: "src/util.ts", kind: "file", content: "export const y = 2;" };
    const msg = buildBackendMessage("review this", emptyCtx, [att]);
    expect(msg).toContain("--- Attached: src/util.ts ---");
    expect(msg).toContain("export const y = 2;");
  });

  it("S20: an analyzed image is injected safely as a visual-analysis block", () => {
    const verdict = classifyAttachment({ fileName: "shot.png", ext: ".png", byteLength: 4000, relativePath: "shot.png" });
    expect(verdict).toEqual({ ok: true, kind: "image" });
    const att: Attachment = { id: "i1", label: "shot.png", kind: "image", content: "A screenshot of a login form with an error banner." };
    const msg = buildBackendMessage("what is wrong?", emptyCtx, [att]);
    expect(msg).toContain('[Image "shot.png" — visual analysis]');
    expect(msg).toContain("login form");
  });

  it("S21: an unsupported binary type is rejected", () => {
    const verdict = classifyAttachment({ fileName: "app.exe", ext: ".exe", byteLength: 1000, relativePath: "bin/app.exe" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/unsupported binary/i);
  });

  it("S22: an oversized file is rejected", () => {
    const verdict = classifyAttachment({ fileName: "big.ts", ext: ".ts", byteLength: MAX_ATTACHMENT_BYTES + 1, relativePath: "big.ts" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/limit/i);
  });

  it("S23: a path-traversal escape is rejected", () => {
    for (const rel of ["../../../etc/passwd", "..\\..\\secrets", "sub/../../escape"]) {
      const verdict = classifyAttachment({ fileName: "x", ext: ".txt", byteLength: 10, relativePath: rel });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toMatch(/escape/i);
    }
  });

  it("S24: a binary/failed attachment degrades gracefully without breaking the message", () => {
    const binary: Attachment = { id: "b1", label: "data.bin", kind: "file", content: undefined };
    const imageNoVision: Attachment = { id: "i2", label: "diagram.png", kind: "image", dataUri: "data:image/png;base64,AAAA", content: undefined };
    const msg = buildBackendMessage("hello", emptyCtx, [binary, imageNoVision]);
    expect(msg).toContain("[Attached (binary): data.bin]");
    expect(msg).toContain("vision analysis unavailable");
    expect(msg.startsWith("hello")).toBe(true);
  });
});
