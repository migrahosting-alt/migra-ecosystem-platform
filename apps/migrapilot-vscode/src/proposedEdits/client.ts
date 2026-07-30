/**
 * Thin HTTP client for the pilot-api proposed-edit endpoints. Mirrors PilotClient
 * config resolution (pilotApiUrl / apiToken). The backend is authoritative for
 * persistence, approval, authorization, audit and rollback metadata; this client
 * only carries strictly-typed proposals and live-state to it.
 */
import * as vscode from "vscode";
import type { EditProposal, FileLiveState, RollbackLiveState, ApplyFileResult } from "./types";

export interface AuthorizeApplyResponse {
  allowed: boolean;
  reasons: string[];
  nonce?: string;
  files?: Array<{ path: string; operation: string; renameTo: string | null; proposedContent: string | null }>;
}
export interface AuthorizeRollbackResponse {
  allowed: boolean;
  reasons: string[];
  plan?: Array<{ path: string; operation: string; renameTo: string | null; preApplyContent: string | null }>;
}

export class ProposedEditClient {
  private cfg() { return vscode.workspace.getConfiguration("migrapilot"); }
  public baseUrl(): string {
    const u = this.cfg().get<string>("pilotApiUrl");
    return (u && u.trim() ? u : "http://127.0.0.1:3377").replace(/\/+$/, "");
  }
  private token(): string | undefined {
    const t = this.cfg().get<string>("apiToken");
    return t && t.trim() ? t : undefined;
  }
  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; ok: boolean; data?: T; error?: string; code?: string }> {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      return { status: 0, ok: false, error: `Could not reach pilot-api at ${this.baseUrl()} (${e?.message ?? "network error"}).` };
    }
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, ok: !!json.ok, data: json.data as T, error: json.error, code: json.code };
  }

  create(payload: unknown) { return this.call<EditProposal>("POST", "/api/pilot/proposed-edits", payload); }
  get(id: string) { return this.call<EditProposal>("GET", `/api/pilot/proposed-edits/${id}`); }
  view(id: string) { return this.call<EditProposal>("POST", `/api/pilot/proposed-edits/${id}/view`); }
  approve(id: string, workspaceId: string) { return this.call<EditProposal>("POST", `/api/pilot/proposed-edits/${id}/approve`, { workspaceId }); }
  reject(id: string, reason?: string) { return this.call<EditProposal>("POST", `/api/pilot/proposed-edits/${id}/reject`, { reason }); }
  authorizeApply(id: string, workspaceId: string, files: FileLiveState[]) {
    return this.call<AuthorizeApplyResponse>("POST", `/api/pilot/proposed-edits/${id}/authorize-apply`, { workspaceId, files });
  }
  recordApplied(id: string, nonce: string, outcome: string, results: ApplyFileResult[]) {
    return this.call<EditProposal>("POST", `/api/pilot/proposed-edits/${id}/applied`, { nonce, outcome, results });
  }
  authorizeRollback(id: string, files: RollbackLiveState[]) {
    return this.call<AuthorizeRollbackResponse>("POST", `/api/pilot/proposed-edits/${id}/authorize-rollback`, { files });
  }
  recordRolledBack(id: string) { return this.call<EditProposal>("POST", `/api/pilot/proposed-edits/${id}/rolled-back`); }
}
