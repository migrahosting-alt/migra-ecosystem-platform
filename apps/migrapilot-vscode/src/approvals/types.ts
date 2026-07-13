/**
 * Phase D — the approval card.
 *
 * This is the one thing a human looks at before a live mutation runs. Everything the server does
 * behind it (exact-action binding, single-use consumption, fresh policy revalidation, refusal to
 * re-plan) is worthless if this card misrepresents what is about to happen.
 *
 * So the card shows the ACTION, not a paraphrase of it: the tool, the real arguments, the tenant,
 * and whether it is LIVE or a dry run. The server's own summary is displayed, and it is the
 * server — not the model — that writes it.
 */

/** Exactly what the server sent on the `approval_request` SSE event. Nothing is inferred here. */
export interface ApprovalCard {
  pendingActionId: string;
  approvalId: string;
  toolName: string;
  /** Written server-side by describeAction(). Never softened, never model-authored. */
  summary: string;
  /** The REAL arguments. Shown in full — a summary is never a substitute. */
  args: Record<string, unknown>;
  mode: "live" | "dry_run";
  tenantScope?: string | null;
  expiresAt: string;
  conversationId?: string | null;
}

export type ApprovalAction = "approve" | "reject";

/** The server's state machine, reflected verbatim. The UI does not invent intermediate states. */
export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "EXECUTING"
  | "EXECUTED"
  | "FAILED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

export interface ApprovalOutcome {
  status: "EXECUTED" | "FAILED";
  toolName: string;
  result?: unknown;
  error?: { code: string; message: string };
}
