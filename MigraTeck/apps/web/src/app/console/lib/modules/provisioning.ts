import { randomUUID } from "node:crypto";
import { panelExec, isPanelDbConfigured } from "../db";

/**
 * Single canonical enqueue helper for the migrapanel provisioning_tasks table.
 *
 * Previously the codebase had 4+ ad-hoc INSERT shapes for this table — each
 * page constructed its own SQL with slightly different column lists. This
 * helper consolidates them all, so changes to the worker contract only need
 * to land here.
 *
 * Defaults: status='queued', idempotencyKey=random UUID, createdAt=NOW().
 * Returns the id of the inserted task, or null on failure (which is logged).
 *
 * NEVER throws. Failing to queue a worker task is recoverable — the calling
 * mutation must have already completed before this is called. Errors are
 * logged to stderr.
 */
export type EnqueueProvisioningTask = {
  type: string;
  tenantId: string;
  serviceInstanceId?: string | null;
  payload?: Record<string, unknown> | null;
  status?: "queued" | "pending";
  idempotencyKey?: string;
};

export const enqueueProvisioningTask = async (
  input: EnqueueProvisioningTask,
): Promise<string | null> => {
  if (!isPanelDbConfigured() || !input.tenantId || !input.type) return null;

  const id = randomUUID();
  const status = input.status ?? "queued";
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const hasPayload = input.payload !== undefined && input.payload !== null;
  const hasService =
    input.serviceInstanceId !== undefined && input.serviceInstanceId !== null;

  try {
    if (hasService && hasPayload) {
      await panelExec(
        `INSERT INTO provisioning_tasks
           (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt", payload)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::jsonb)`,
        [id, input.tenantId, input.serviceInstanceId!, input.type, status, idempotencyKey, JSON.stringify(input.payload)],
      );
    } else if (hasService) {
      await panelExec(
        `INSERT INTO provisioning_tasks
           (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [id, input.tenantId, input.serviceInstanceId!, input.type, status, idempotencyKey],
      );
    } else if (hasPayload) {
      await panelExec(
        `INSERT INTO provisioning_tasks
           (id, "tenantId", type, status, "idempotencyKey", "createdAt", payload)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6::jsonb)`,
        [id, input.tenantId, input.type, status, idempotencyKey, JSON.stringify(input.payload)],
      );
    } else {
      await panelExec(
        `INSERT INTO provisioning_tasks
           (id, "tenantId", type, status, "idempotencyKey", "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [id, input.tenantId, input.type, status, idempotencyKey],
      );
    }
    return id;
  } catch (err) {
    console.error("[provisioning] enqueue failed", {
      type: input.type,
      tenantId: input.tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};
