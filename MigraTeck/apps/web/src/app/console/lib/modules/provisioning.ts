import { panelExec, isPanelDbConfigured } from "../db";

/**
 * Provisioning task enqueue — DISABLED, because it never executed anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * This helper INSERTed a row into `provisioning_tasks` and returned its id.
 * Callers treated a returned id as success:
 *
 *     const taskId = await enqueueProvisioningTask({...});
 *     if (!taskId) throw new Error("Failed to queue deploy");
 *
 * The INSERT always succeeded, so the throw never fired, `withAuditedAction`
 * recorded SUCCESS, and the page told the operator "Backend workers pick them up
 * — typically completes in 30-120 seconds."
 *
 * Nothing picked them up. The worker is woken by a REDIS JOB and only then looks
 * the task up by id; it never polls this table. This helper published no job. No
 * code anywhere SELECTs from `provisioning_tasks`, and the table holds 0 rows.
 *
 * So "Deploy latest", "Run backup now", "Force SSL renew", "Renew client" and
 * "Renew subscription" all reported success while doing nothing at all.
 *
 * The original docstring contained the mistaken assumption in one sentence:
 * "the calling mutation must have already completed before this is called."
 * For those five actions the enqueue WAS the entire mutation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT NOW REFUSES INSTEAD OF INSERTING
 *
 * A row recording an intended task is not execution, and an inserted id is not
 * success. Writing a row nobody reads manufactures the appearance of a queue, so
 * this no longer writes one. It returns null and the callers fail closed.
 *
 * The operator-facing controls that depended on it have been removed from the
 * UI in the same change: a disabled button still implies the capability exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REAL REPLACEMENT IS NOT READY
 *
 * panel-api's `POST /internal/operations/provisioning` is the right shape —
 * durable intent, then the task row, then `enqueueJob` — and it is registered
 * and live. But it writes `control_operations` in 8 places and **that table does
 * not exist**; no schema or migration defines it. Adopting it today would move
 * the failure, not remove it.
 *
 * Before that path can be adopted it needs: the schema, a real executor, target
 * authority, RBAC and audit, lifecycle/progress state, independent completion
 * verification, failure semantics, and tests.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type EnqueueProvisioningTask = {
  type: string;
  tenantId: string;
  serviceInstanceId?: string | null;
  payload?: Record<string, unknown> | null;
  status?: "queued" | "pending";
  idempotencyKey?: string;
};

/** Shown to an operator if one of these paths is somehow reached. */
export const PROVISIONING_UNAVAILABLE =
  "This operation is temporarily unavailable while its execution path is being reconciled. Nothing was queued and nothing was changed.";

/**
 * Always returns null. Callers already treat null as failure and throw, so every
 * one of them now fails closed rather than reporting a success it cannot back.
 *
 * `panelExec` and `isPanelDbConfigured` stay imported deliberately: this file
 * regains a working implementation once a real executor exists, and the import
 * list documents what it will need.
 */
export const enqueueProvisioningTask = async (
  input: EnqueueProvisioningTask,
): Promise<string | null> => {
  void panelExec;
  void isPanelDbConfigured;
  console.warn(
    "[provisioning] refused: no execution path for this task type — nothing was queued",
    { type: input.type, tenantId: input.tenantId },
  );
  return null;
};

/** Throws the operator-facing message. For call sites that need an explicit stop. */
export const provisioningCommandUnavailable = (): never => {
  throw new Error(PROVISIONING_UNAVAILABLE);
};
