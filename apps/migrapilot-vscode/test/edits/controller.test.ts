import { describe, it, expect, beforeEach } from "vitest";
import { ProposedEditController } from "../../src/proposedEdits/controller";
import { ToolResultError, sha256, isSecretLikePath } from "../../src/proposedEdits/editSafety";
import { __resetFs, __seedFile, __readFile, __exists } from "../harness/vscodeMock";

/**
 * Faithful in-memory stand-in for the pilot-api proposed-edit backend. Enforces
 * the SAME fail-closed rules (approval required, single-use nonce, stale/dirty
 * blocking, workspace binding) so the controller orchestration + the REAL local
 * WorkspaceEdit apply path are exercised end to end without a live server.
 */
class FakeBackend {
  private store = new Map<string, any>();
  private seq = 0;
  private ok(data: any) { return { status: 200, ok: true, data }; }
  private no(status: number, error: string, reasons?: string[]) { return { status, ok: false, error, data: reasons ? { allowed: false, reasons } : undefined }; }

  async create(payload: any) {
    const id = `p${++this.seq}`;
    const files = payload.files.map((f: any) => {
      const sensitive = isSecretLikePath(f.path);
      return { path: f.path, operation: f.operation, renameTo: f.renameTo ?? null,
        originalHash: f.originalHash ?? null, proposedHash: f.proposedContent != null ? sha256(f.proposedContent) : null,
        proposedContent: sensitive ? null : (f.proposedContent ?? null), sensitive, riskClass: sensitive ? "HIGH" : "LOW", applyState: "pending" };
    });
    const dto = { id, workspaceId: payload.workspaceId, conversationId: payload.conversationId, missionId: payload.missionId,
      taskId: payload.taskId, title: payload.title, explanation: payload.explanation, status: "PROPOSED", riskClass: "MEDIUM",
      dryRun: true, files, generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString() };
    this.store.set(id, dto);
    return this.ok(dto);
  }
  async get(id: string) { const d = this.store.get(id); return d ? this.ok(structuredClone(d)) : this.no(404, "not found"); }
  async view(id: string) { return this.get(id); }
  async approve(id: string, workspaceId: string) {
    const d = this.store.get(id); if (!d) return this.no(404, "not found");
    if (d.workspaceId !== workspaceId) return this.no(409, "WORKSPACE_MISMATCH");
    if (d.status !== "PROPOSED") return this.no(409, `cannot approve ${d.status}`);
    d.status = "APPROVED"; return this.ok(structuredClone(d));
  }
  async reject(id: string) { const d = this.store.get(id); if (!d) return this.no(404, "nf"); d.status = "REJECTED"; return this.ok(structuredClone(d)); }
  async authorizeApply(id: string, workspaceId: string, live: any[]) {
    const d = this.store.get(id); if (!d) return this.no(404, "nf");
    const reasons: string[] = [];
    if (d.workspaceId !== workspaceId) reasons.push("workspace_mismatch");
    if (d.status !== "APPROVED") reasons.push(`not_approved:${d.status}`);
    const byPath = new Map(live.map((l) => [l.path, l]));
    for (const f of d.files) {
      if (f.sensitive) { reasons.push(`sensitive_file:${f.path}`); continue; }
      const l = byPath.get(f.path);
      if (!l) { reasons.push(`missing_live:${f.path}`); continue; }
      if (l.dirty) reasons.push(`dirty:${f.path}`);
      if (f.operation === "create") { if (l.exists) reasons.push(`already_exists:${f.path}`); }
      else if (!l.exists) reasons.push(`missing_on_disk:${f.path}`);
      else if (l.currentHash !== f.originalHash) reasons.push(`stale:${f.path}`);
    }
    if (reasons.length) return { status: 409, ok: false, data: { allowed: false, reasons } };
    d.status = "APPLYING"; d.nonce = `n${this.seq++}`;
    return { status: 200, ok: true, data: { allowed: true, reasons: [], nonce: d.nonce,
      files: d.files.map((f: any) => ({ path: f.path, operation: f.operation, renameTo: f.renameTo, proposedContent: f.proposedContent })) } };
  }
  async recordApplied(id: string, nonce: string, outcome: string, results: any[]) {
    const d = this.store.get(id); if (!d) return this.no(404, "nf");
    if (d.status !== "APPLYING" || d.nonce !== nonce) return this.no(409, "INVALID_NONCE");
    for (const r of results) { const f = d.files.find((x: any) => x.path === r.path); if (f) { f.applyState = r.applyState; f.preApplyContent = r.preApplyContent ?? null; f.postApplyHash = r.postApplyHash ?? null; } }
    d.status = outcome === "applied" ? "APPLIED" : results.some((r) => r.applyState === "applied") ? "PARTIALLY_APPLIED" : "FAILED";
    d.nonce = null; return this.ok(structuredClone(d));
  }
  async authorizeRollback(id: string, files: any[]) {
    const d = this.store.get(id); if (!d) return this.no(404, "nf");
    if (!["APPLIED", "PARTIALLY_APPLIED"].includes(d.status)) return { status: 409, ok: false, data: { allowed: false, reasons: [`not_applied:${d.status}`] } };
    const applied = d.files.filter((f: any) => f.applyState === "applied");
    const byPath = new Map(files.map((l) => [l.path, l]));
    const reasons: string[] = [];
    for (const f of applied) {
      const target = f.operation === "rename" ? f.renameTo : f.path;
      const l = byPath.get(target);
      if (f.operation === "delete") { if (l?.exists) reasons.push(`recreated:${f.path}`); }
      else if (!l?.exists || l.currentHash !== f.postApplyHash) reasons.push(`changed_since_apply:${target}`);
    }
    if (reasons.length) return { status: 409, ok: false, data: { allowed: false, reasons } };
    return { status: 200, ok: true, data: { allowed: true, reasons: [], plan: applied.map((f: any) => ({ path: f.path, operation: f.operation, renameTo: f.renameTo, preApplyContent: f.preApplyContent })) } };
  }
  async recordRolledBack(id: string) { const d = this.store.get(id); if (!d) return this.no(404, "nf"); d.status = "ROLLED_BACK"; return this.ok(structuredClone(d)); }
}

const BIND = { workspaceId: "ws:test", conversationId: "c1", missionId: "m1", taskId: null };
function makeController() {
  const backend = new FakeBackend();
  const events: any[] = [];
  const controller = new ProposedEditController(backend as any, {
    onStatus: (id, status, detail) => events.push({ id, status, detail }),
    onBlocked: (id, reasons) => events.push({ id, blocked: reasons }),
  });
  return { controller, backend, events };
}
function toolResult(over: any = {}) {
  return { kind: "proposed_edit", title: "Fix", explanation: "why",
    files: [{ path: "src/a.ts", operation: "modify", originalContent: "old", proposedContent: "NEW" }], ...over };
}

beforeEach(() => { __resetFs(); });

describe("controller — plain text can never trigger a proposal or apply (scenarios 26,30)", () => {
  it("receiveToolResult rejects plain model text and mints no proposal", async () => {
    const { controller, backend } = makeController();
    await expect(controller.receiveToolResult("please change src/a.ts to fix the bug", BIND)).rejects.toBeInstanceOf(ToolResultError);
    // no proposal exists → nothing is ever applicable (no orphan)
    const got = await backend.get("p1");
    expect(got.ok).toBe(false);
  });
});

describe("controller — approve → real WorkspaceEdit apply → rollback (scenarios 1,6,20)", () => {
  it("runs the full happy path and the file physically changes then restores", async () => {
    __seedFile("src/a.ts", "old");
    const { controller } = makeController();
    const p = await controller.receiveToolResult(toolResult(), BIND);
    expect(p.status).toBe("received");

    const appr = await controller.approve(p.id, BIND.workspaceId);
    expect(appr.status).toBe("approved");

    const applied = await controller.apply(p.id, BIND.workspaceId);
    expect(applied.ok).toBe(true);
    expect(applied.status).toBe("applied");
    expect(__readFile("src/a.ts")).toBe("NEW");           // real file write happened

    const rb = await controller.rollback(p.id);
    expect(rb.ok).toBe(true);
    expect(rb.status).toBe("rolled_back");
    expect(__readFile("src/a.ts")).toBe("old");           // restored
  });
});

describe("controller — approval gates apply (scenarios 7,27)", () => {
  it("apply without approval is blocked and writes nothing", async () => {
    __seedFile("src/a.ts", "old");
    const { controller } = makeController();
    const p = await controller.receiveToolResult(toolResult(), BIND);
    const r = await controller.apply(p.id, BIND.workspaceId); // never approved
    expect(r.ok).toBe(false);
    expect(r.status).toBe("blocked");
    expect(r.reasons?.some((x) => x.startsWith("not_approved"))).toBe(true);
    expect(__readFile("src/a.ts")).toBe("old");
  });

  it("a rejected proposal can never be applied", async () => {
    __seedFile("src/a.ts", "old");
    const { controller } = makeController();
    const p = await controller.receiveToolResult(toolResult(), BIND);
    await controller.reject(p.id, "no thanks");
    const r = await controller.apply(p.id, BIND.workspaceId);
    expect(r.ok).toBe(false);
    expect(r.reasons?.some((x) => x.includes("not_approved:REJECTED"))).toBe(true);
    expect(__readFile("src/a.ts")).toBe("old");
  });
});

describe("controller — workspace + staleness binding (scenarios 11,17)", () => {
  it("blocks approval from a different workspace identity", async () => {
    __seedFile("src/a.ts", "old");
    const { controller } = makeController();
    const p = await controller.receiveToolResult(toolResult(), BIND);
    const r = await controller.approve(p.id, "ws:some-other-workspace");
    expect(r.ok).toBe(false);
    expect(r.status).toBe("blocked");
  });

  it("blocks apply when the file changed between proposal and apply", async () => {
    __seedFile("src/a.ts", "old");
    const { controller } = makeController();
    const p = await controller.receiveToolResult(toolResult(), BIND);
    await controller.approve(p.id, BIND.workspaceId);
    __seedFile("src/a.ts", "CHANGED BY SOMEONE ELSE");     // external change after approval
    const r = await controller.apply(p.id, BIND.workspaceId);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("stale:src/a.ts");
    expect(__readFile("src/a.ts")).toBe("CHANGED BY SOMEONE ELSE"); // untouched
  });
});
