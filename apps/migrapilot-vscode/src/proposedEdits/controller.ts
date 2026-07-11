/**
 * Proposed-edit controller — the single orchestrated flow (mission §1):
 *
 *   tool result → strict proposal → backend create → review/diff → approve →
 *   backend authorize-apply (fail closed) → local WorkspaceEdit apply →
 *   backend record-applied → rollback (backend authorize → local restore → record).
 *
 * Defense in depth: an apply requires BOTH a backend authorization (approved,
 * unexpired, in-scope, non-stale, non-sensitive) AND a local fail-closed
 * preflight. Plain model text never reaches this flow — proposalFromToolResult
 * rejects anything that is not a strict proposed_edit structure.
 */
import type { EditProposal, ProposalFile, ProposalStatus, RollbackPlanItem } from "./types";
import { proposalFromToolResult, annotateProposalFile, ToolResultError } from "./editSafety";
import { applyProposal, collectLiveState, collectRollbackState, rollbackProposal } from "./applyEngine";
import { ProposedEditClient } from "./client";

export interface ProposalUiSink {
  onProposalUpdate?(p: EditProposal): void;
  onStatus?(id: string, status: ProposalStatus, detail?: string): void;
  onBlocked?(id: string, reasons: string[]): void;
}

export interface WorkspaceBinding { workspaceId: string; conversationId?: string | null; missionId?: string | null; taskId?: string | null }

export interface FlowResult { ok: boolean; status: ProposalStatus; reasons?: string[]; proposal?: EditProposal }

function mapDto(dto: any): EditProposal {
  const files: ProposalFile[] = (dto.files ?? []).map((f: any) => annotateProposalFile({
    path: f.path, operation: f.operation, renameTo: f.renameTo ?? null,
    originalHash: f.originalHash ?? null, proposedHash: f.proposedHash ?? null,
    proposedContent: f.proposedContent ?? null, sensitive: !!f.sensitive,
    riskClass: f.riskClass ?? "LOW", postApplyHash: f.postApplyHash ?? null, applyState: f.applyState,
  }));
  const statusMap: Record<string, ProposalStatus> = {
    PROPOSED: "received", APPROVED: "approved", REJECTED: "rejected", APPLYING: "applying",
    APPLIED: "applied", PARTIALLY_APPLIED: "partially_applied", FAILED: "failed",
    ROLLED_BACK: "rolled_back", EXPIRED: "expired",
  };
  return {
    id: dto.id, workspaceId: dto.workspaceId, conversationId: dto.conversationId, missionId: dto.missionId,
    taskId: dto.taskId, title: dto.title, explanation: dto.explanation,
    status: statusMap[dto.status] ?? "received", riskClass: dto.riskClass ?? "LOW",
    dryRun: dto.dryRun !== false, provider: dto.provider, generatedAt: dto.generatedAt, expiresAt: dto.expiresAt, files,
  };
}

export class ProposedEditController {
  constructor(private readonly client: ProposedEditClient, private readonly sink: ProposalUiSink = {}) {}

  private emit(p: EditProposal) { this.sink.onProposalUpdate?.(p); this.sink.onStatus?.(p.id, p.status); }

  /**
   * Convert a STRICT tool result into a persisted proposal. Throws ToolResultError
   * for plain text / shapeless input — the wall in mission §26.
   */
  async receiveToolResult(raw: unknown, binding: WorkspaceBinding): Promise<EditProposal> {
    const payload = proposalFromToolResult(raw, binding); // throws on plain text
    const res = await this.client.create(payload);
    if (!res.ok || !res.data) throw new ToolResultError(res.error ?? `backend rejected proposal (${res.status})`);
    const p = mapDto(res.data);
    this.emit(p);
    return p;
  }

  async review(id: string): Promise<EditProposal | undefined> {
    const res = await this.client.view(id);
    if (!res.ok || !res.data) return undefined;
    const p = mapDto(res.data);
    this.sink.onProposalUpdate?.(p);
    this.sink.onStatus?.(id, "reviewing");
    return p;
  }

  async approve(id: string, workspaceId: string): Promise<FlowResult> {
    const res = await this.client.approve(id, workspaceId);
    if (!res.ok || !res.data) return { ok: false, status: "blocked", reasons: [res.error ?? "approve failed"] };
    const p = mapDto(res.data); this.emit(p);
    return { ok: true, status: p.status, proposal: p };
  }

  async reject(id: string, reason?: string): Promise<FlowResult> {
    const res = await this.client.reject(id, reason);
    if (!res.ok || !res.data) return { ok: false, status: "blocked", reasons: [res.error ?? "reject failed"] };
    const p = mapDto(res.data); this.emit(p);
    return { ok: true, status: "rejected", proposal: p };
  }

  /** Approved → authorize (backend) → apply (local WorkspaceEdit) → record. */
  async apply(id: string, workspaceId: string): Promise<FlowResult> {
    const got = await this.client.get(id);
    if (!got.ok || !got.data) return { ok: false, status: "blocked", reasons: [got.error ?? "not found"] };
    const proposal = mapDto(got.data);

    const live = await collectLiveState(proposal);
    const auth = await this.client.authorizeApply(id, workspaceId, live);
    if (!auth.ok || !auth.data?.allowed) {
      const reasons = auth.data?.reasons ?? [auth.error ?? "authorize failed"];
      this.sink.onBlocked?.(id, reasons); this.sink.onStatus?.(id, "blocked", reasons.join(", "));
      return { ok: false, status: "blocked", reasons };
    }

    this.sink.onStatus?.(id, "applying");
    const result = await applyProposal(proposal); // local, fail-closed preflight + WorkspaceEdit
    await this.client.recordApplied(id, auth.data.nonce!, result.outcome, result.results);

    if (result.blocked) { this.sink.onBlocked?.(id, result.reasons); this.sink.onStatus?.(id, "blocked", result.reasons.join(", ")); return { ok: false, status: "blocked", reasons: result.reasons }; }
    const status: ProposalStatus = result.outcome === "applied" ? "applied" : result.outcome === "partial" ? "partially_applied" : "failed";
    this.sink.onStatus?.(id, status === "applied" ? "rollback_available" : status);
    return { ok: result.ok, status, reasons: result.results.filter((r) => r.applyState !== "applied").map((r) => `${r.applyState}:${r.path}`) };
  }

  /** Applied → authorize rollback (backend) → local restore → record. */
  async rollback(id: string): Promise<FlowResult> {
    const got = await this.client.get(id);
    if (!got.ok || !got.data) return { ok: false, status: "blocked", reasons: [got.error ?? "not found"] };
    const proposal = mapDto(got.data);
    const applied = proposal.files.filter((f) => f.applyState === "applied");
    const planItems: RollbackPlanItem[] = applied.map((f) => ({ path: f.path, operation: f.operation, renameTo: f.renameTo, preApplyContent: f.preApplyContent ?? null, postApplyHash: f.postApplyHash ?? null }));

    const liveForAuth = (await collectRollbackState(planItems)).map((l) => ({ path: l.path, currentHash: l.currentHash, exists: l.exists }));
    const auth = await this.client.authorizeRollback(id, liveForAuth);
    if (!auth.ok || !auth.data?.allowed) {
      const reasons = auth.data?.reasons ?? [auth.error ?? "rollback authorize failed"];
      this.sink.onBlocked?.(id, reasons); this.sink.onStatus?.(id, "rollback_available", `blocked: ${reasons.join(", ")}`);
      return { ok: false, status: "blocked", reasons };
    }
    // Prefer the backend-authoritative rollback plan (carries preApplyContent).
    const plan: RollbackPlanItem[] = (auth.data.plan ?? []).map((p) => ({ path: p.path, operation: p.operation as any, renameTo: p.renameTo, preApplyContent: p.preApplyContent, postApplyHash: planItems.find((i) => i.path === p.path)?.postApplyHash ?? null }));
    const result = await rollbackProposal(plan.length ? plan : planItems);
    if (result.blocked || !result.ok) {
      this.sink.onBlocked?.(id, result.reasons); this.sink.onStatus?.(id, "rollback_available", `blocked: ${result.reasons.join(", ")}`);
      return { ok: false, status: "blocked", reasons: result.reasons };
    }
    await this.client.recordRolledBack(id);
    this.sink.onStatus?.(id, "rolled_back");
    return { ok: true, status: "rolled_back" };
  }
}
