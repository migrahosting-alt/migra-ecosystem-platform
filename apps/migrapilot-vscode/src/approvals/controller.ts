/**
 * Phase D — turning a click into exactly one execution, and telling the truth about it.
 *
 * The server owns every guarantee (single-use, no replay, fresh policy revalidation, no
 * re-planning). This controller's only jobs are to send the click and to report back what
 * actually happened — including, especially, when it failed.
 *
 * The most dangerous thing this file could do is render a tidy success over a live mutation that
 * did not happen, or half happened. So there is exactly one rule here:
 *
 *   THE CARD SHOWS THE SERVER'S OUTCOME. IT NEVER ASSUMES ONE.
 *
 * A 2xx is not success. A response with `ok:false` and an `outcome.status === "FAILED"` means the
 * action RAN and FAILED on real infrastructure — a materially different thing from "refused", and
 * the operator must be able to tell those apart at a glance.
 */

import * as vscode from "vscode";
import { approve, reject, resume, type ApprovalResponse } from "./client";

export interface ApprovalUiSink {
  /** Reflect the server's state machine on the card. Never called with an invented state. */
  status: (pendingActionId: string, status: string, detail?: string) => void;
}

export interface ApprovalControllerDeps {
  /** pilot-api base URL. */
  baseUrl: () => string | undefined;
  sink: ApprovalUiSink;
}

/** What the operator is told, in one line, for each way this can end. */
function describeOutcome(res: ApprovalResponse): { status: string; detail: string } {
  if (res.ok && res.outcome?.status === "EXECUTED") {
    return { status: "EXECUTED", detail: "ran once" };
  }

  /* It RAN and FAILED. This is not the same as "refused", and conflating them is how an operator
   * walks away believing nothing happened when something half did. */
  if (res.outcome?.status === "FAILED") {
    const e = res.outcome.error;
    return {
      status: "FAILED",
      detail: e ? `${e.code}: ${e.message}` : "the action ran and failed",
    };
  }

  /* It was REFUSED BEFORE RUNNING — expired, already consumed, policy denied, wrong state. This
   * is a materially different fact from "it ran and failed", and the card must not blur them:
   * after a refusal, nothing happened and there is nothing to go and check. After a failure,
   * something may have partially landed on real infrastructure.
   *
   * The server's reason is shown verbatim. We do not paraphrase a refusal into something
   * friendlier — the reason IS the message. */
  const err = res.error;
  if (err) {
    return { status: "REFUSED", detail: `${err.code}: ${err.message}` };
  }

  /* No outcome, no error. We do not know what happened, and saying anything else would be a
   * guess presented as a fact — the exact failure this whole system keeps being bitten by. */
  return { status: "UNKNOWN", detail: "the server did not say what happened — check the target before retrying" };
}

export class ApprovalController {
  constructor(private readonly deps: ApprovalControllerDeps) {}

  async handle(action: "approve" | "reject", pendingActionId: string): Promise<void> {
    const base = this.deps.baseUrl();
    if (!base) {
      this.deps.sink.status(pendingActionId, "FAILED", "No pilot-api URL configured.");
      return;
    }

    if (action === "reject") {
      const res = await reject(base, pendingActionId);
      if (res.ok) {
        this.deps.sink.status(pendingActionId, "REJECTED", "nothing was executed");
      } else {
        const { status, detail } = describeOutcome(res);
        this.deps.sink.status(pendingActionId, status, detail);
      }
      return;
    }

    /* Approve is a single request that both records the decision and runs the action once. If the
     * process dies between those two transitions, the approval survives and the action is left
     * APPROVED — recoverable via `resume`, never half-run. */
    this.deps.sink.status(pendingActionId, "EXECUTING", "running once…");
    const res = await approve(base, pendingActionId);
    const { status, detail } = describeOutcome(res);
    this.deps.sink.status(pendingActionId, status, detail);

    if (status === "EXECUTED") {
      vscode.window.showInformationMessage("MigraPilot: the approved action ran.");
    } else if (status === "REFUSED") {
      /* Nothing ran. Say so plainly, so the operator does not go hunting for a change that was
       * never made. */
      vscode.window.showWarningMessage(`MigraPilot: refused — nothing was executed. ${detail}`);
    } else {
      /* It RAN and did not complete. This is not a footnote: something may have partially landed
       * on real infrastructure, and the operator may need to go and look. */
      vscode.window.showErrorMessage(`MigraPilot: the approved action RAN and did not complete — ${detail}`);
    }
  }

  /**
   * Crash recovery from the UI: an action that was approved but never ran, because the server
   * died in between. Without this the operator's decision survived in the database and was
   * unreachable — which, from where they sit, is the same as losing it.
   */
  async resumeApproved(pendingActionId: string): Promise<void> {
    const base = this.deps.baseUrl();
    if (!base) return;
    this.deps.sink.status(pendingActionId, "EXECUTING", "resuming after interruption…");
    const res = await resume(base, pendingActionId);
    const { status, detail } = describeOutcome(res);
    this.deps.sink.status(pendingActionId, status, detail);
  }
}
