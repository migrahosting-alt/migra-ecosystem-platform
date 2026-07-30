/**
 * Faithful in-memory stand-in for the pilot-api proposed-edit backend. Enforces the
 * SAME fail-closed rules as Phase C (approval required, single-use nonce, stale/dirty
 * blocking, workspace binding, rollback staleness) so the ProposedEditController
 * orchestration + the REAL local WorkspaceEdit apply/rollback path run end-to-end
 * without a live server. Mirrors the fake used in controller.test.ts.
 */
import { sha256, isSecretLikePath } from "../../src/proposedEdits/editSafety";

export class FakeProposalBackend {
  private store = new Map<string, any>();
  private seq = 0;
  private ok(data: any) { return { status: 200, ok: true, data }; }
  private no(status: number, error: string, reasons?: string[]) { return { status, ok: false, error, data: reasons ? { allowed: false, reasons } : undefined }; }

  /** Snapshot of every proposal id currently stored (orphan detection). */
  public ids(): string[] { return [...this.store.keys()]; }
  public status(id: string): string | undefined { return this.store.get(id)?.status; }

  async create(payload: any) {
    const id = `p${++this.seq}`;
    const files = payload.files.map((f: any) => {
      const sensitive = isSecretLikePath(f.path);
      return {
        path: f.path, operation: f.operation, renameTo: f.renameTo ?? null,
        originalHash: f.originalHash ?? null, proposedHash: f.proposedContent != null ? sha256(f.proposedContent) : null,
        proposedContent: sensitive ? null : (f.proposedContent ?? null), sensitive,
        riskClass: sensitive ? "HIGH" : "LOW", applyState: "pending",
      };
    });
    const dto = {
      id, workspaceId: payload.workspaceId, conversationId: payload.conversationId ?? null, missionId: payload.missionId ?? null,
      taskId: payload.taskId ?? null, title: payload.title, explanation: payload.explanation, status: "PROPOSED",
      riskClass: files.some((f: any) => f.sensitive) ? "HIGH" : "MEDIUM", dryRun: true, files,
      generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    };
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
