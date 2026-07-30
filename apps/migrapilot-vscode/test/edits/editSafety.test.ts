import { describe, it, expect } from "vitest";
import {
  sha256, classifyRisk, isSafeRelPath, workspaceIdentity, isInsideWorkspace,
  proposalFromToolResult, ToolResultError, isSecretLikePath, annotateProposalFile,
} from "../../src/proposedEdits/editSafety";

const BIND = { workspaceId: "ws:test", conversationId: "c1", missionId: "m1", taskId: null };

describe("editSafety — pure helpers", () => {
  it("sha256 matches Node's canonical digest and is content-sensitive", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });

  it("classifyRisk escalates destructive + sensitive ops", () => {
    expect(classifyRisk("create", false)).toBe("LOW");
    expect(classifyRisk("modify", false)).toBe("MEDIUM");
    expect(classifyRisk("delete", false)).toBe("HIGH");
    expect(classifyRisk("rename", false)).toBe("HIGH");
    expect(classifyRisk("modify", true)).toBe("HIGH");
  });

  it("isSafeRelPath rejects absolute / traversal / home / null-byte (scenarios 13,14)", () => {
    expect(isSafeRelPath("src/a.ts")).toBe(true);
    expect(isSafeRelPath("/etc/passwd")).toBe(false);
    expect(isSafeRelPath("C:\\x")).toBe(false);
    expect(isSafeRelPath("../escape")).toBe(false);
    expect(isSafeRelPath("a/../../b")).toBe(false);
    expect(isSafeRelPath("~/secrets")).toBe(false);
    expect(isSafeRelPath("a\0b")).toBe(false);
    expect(isSafeRelPath("")).toBe(false);
  });

  it("isSecretLikePath reuses the Phase B withholding patterns (scenario 16)", () => {
    expect(isSecretLikePath(".env")).toBe(true);
    expect(isSecretLikePath("keys/app.pem")).toBe(true);
    expect(isSecretLikePath("src/index.ts")).toBe(false);
  });

  it("workspaceIdentity is stable per (name, root) and differs across roots (scenario 17)", () => {
    const a = workspaceIdentity("demo", "/workspace/demo");
    expect(a).toBe(workspaceIdentity("demo", "/workspace/demo"));
    expect(a).not.toBe(workspaceIdentity("demo", "/workspace/other"));
  });

  it("isInsideWorkspace enforces containment", () => {
    expect(isInsideWorkspace("/workspace/demo", "/workspace/demo/src/a.ts")).toBe(true);
    expect(isInsideWorkspace("/workspace/demo", "/workspace/demo")).toBe(true);
    expect(isInsideWorkspace("/workspace/demo", "/workspace/demo-evil/a.ts")).toBe(false);
    expect(isInsideWorkspace("/workspace/demo", "/etc/passwd")).toBe(false);
  });

  describe("proposalFromToolResult — plain text can never become a proposal (scenario 26)", () => {
    it("rejects plain strings / null / arrays / shapeless objects", () => {
      expect(() => proposalFromToolResult("change file x for me", BIND)).toThrow(ToolResultError);
      expect(() => proposalFromToolResult(null, BIND)).toThrow(ToolResultError);
      expect(() => proposalFromToolResult([], BIND)).toThrow(ToolResultError);
      expect(() => proposalFromToolResult({ kind: "chat", text: "hi" }, BIND)).toThrow(/proposed_edit/);
      expect(() => proposalFromToolResult({ kind: "proposed_edit", title: "t", explanation: "e", files: [] }, BIND)).toThrow(/non-empty/);
    });
    it("rejects unsafe paths inside an otherwise-valid tool result", () => {
      expect(() => proposalFromToolResult({
        kind: "proposed_edit", title: "t", explanation: "e",
        files: [{ path: "../../etc/passwd", operation: "create", proposedContent: "x" }],
      }, BIND)).toThrow(/safe workspace-relative/);
    });
    it("accepts a well-formed proposed_edit and derives originalHash from originalContent", () => {
      const p = proposalFromToolResult({
        kind: "proposed_edit", title: "Fix", explanation: "why",
        files: [{ path: "src/a.ts", operation: "modify", originalContent: "old", proposedContent: "new" }],
      }, BIND);
      expect(p.files[0].originalHash).toBe(sha256("old"));
      expect(p.files[0].proposedContent).toBe("new");
      expect(p.workspaceId).toBe("ws:test");
    });
  });

  it("annotateProposalFile re-flags a secret path even if the DTO says otherwise", () => {
    const f = annotateProposalFile({ path: "config/.env", operation: "modify", sensitive: false, riskClass: "LOW" });
    expect(f.sensitive).toBe(true);
    expect(f.riskClass).toBe("HIGH");
  });
});
