/**
 * The approval inbox, over HTTP.
 *
 * Thin on purpose: every guarantee lives on the server (single-use, no replay, policy
 * revalidated at execution). This client must not add optimism of its own — in particular it
 * NEVER reports success from an HTTP 2xx alone. A pending action that ran and FAILED comes back
 * as a non-ok body, and the caller has to see the failure, not a green tick.
 */
import type { ApprovalOutcome, ApprovalStatus } from "./types";

export interface ApprovalResponse {
  ok: boolean;
  status?: ApprovalStatus;
  outcome?: ApprovalOutcome;
  error?: { code: string; message: string };
}

async function post(base: string, path: string, body: unknown): Promise<ApprovalResponse> {
  let res: any;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err: any) {
    return { ok: false, error: { code: "NETWORK", message: `Could not reach pilot-api: ${err?.message ?? "network error"}` } };
  }

  let json: any = {};
  try { json = await res.json(); } catch { /* an empty body is handled below */ }

  /* The server distinguishes "the action ran and failed" (502, ok:false, with the outcome) from
   * "the request was refused" (409/403, ok:false, no outcome). Both are failures to the operator,
   * and both must arrive here as ok:false — an HTTP status alone is not the verdict. */
  const data = json?.data ?? {};
  return {
    ok: json?.ok === true,
    status: data.status,
    outcome: data.outcome,
    error: json?.error ?? (res.ok ? undefined : { code: String(res.status), message: res.statusText }),
  };
}

export function approve(base: string, id: string, actorId?: string): Promise<ApprovalResponse> {
  return post(base, `/api/pilot/pending-actions/${id}/approve`, { actorId });
}

export function reject(base: string, id: string, actorId?: string, reason?: string): Promise<ApprovalResponse> {
  return post(base, `/api/pilot/pending-actions/${id}/reject`, { actorId, reason });
}

/** Crash recovery: an action approved but never run (the server died in between). */
export function resume(base: string, id: string, actorId?: string): Promise<ApprovalResponse> {
  return post(base, `/api/pilot/pending-actions/${id}/resume`, { actorId });
}
