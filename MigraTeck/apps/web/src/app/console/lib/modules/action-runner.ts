import { revalidatePath } from "next/cache";
import { logClientEvent } from "./audit";
import { notifyLifecycle } from "./notifications";
import { tenantPath } from "../urls";

/**
 * Generic "tenant mutation" runner used by:
 *   - server actions (client-actions.ts, hosting-actions.ts, etc.)
 *   - API routes (/api/console/...)
 *   - background workers / scripts that want auditing
 *
 * Wraps a side-effectful operation in:
 *   - try/catch (errors get a failure row in client_events instead of bubbling)
 *   - audit log write
 *   - lifecycle notification (Slack/email) if the action is in the notable set
 *   - revalidatePath of the tenant detail page
 *
 * NEVER throws. Returns { ok, error } so callers can react.
 */

export type AuditedActionInput = {
  tenantId: string;
  actor: string | null;
  action: string;
  resource?: string;
  resourceId?: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  notify?: boolean;
  /** Path to revalidatePath on completion. Defaults to the tenant detail page. */
  revalidate?: string;
  /** Set to true to skip the automatic revalidatePath. */
  skipRevalidate?: boolean;
  /** The actual mutation. May throw — its error will be caught and logged. */
  run: () => Promise<void>;
};

export type AuditedActionResult = {
  ok: boolean;
  error?: string;
};

export const withAuditedAction = async (
  input: AuditedActionInput,
): Promise<AuditedActionResult> => {
  try {
    await input.run();
    await logClientEvent({
      tenantId: input.tenantId,
      actorEmail: input.actor,
      action: input.action,
      ...(input.resource !== undefined && { resource: input.resource }),
      ...(input.resourceId !== undefined && { resourceId: input.resourceId }),
      ...(input.reason !== undefined && { reason: input.reason }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    });
    if (input.notify) {
      await notifyLifecycle({
        tenantId: input.tenantId,
        action: input.action,
        ...(input.actor !== null && { actorEmail: input.actor }),
        ...(input.reason !== undefined && input.reason !== null && { reason: input.reason }),
      });
    }
    if (!input.skipRevalidate) {
      revalidatePath(input.revalidate ?? tenantPath(input.tenantId));
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logClientEvent({
      tenantId: input.tenantId,
      actorEmail: input.actor,
      action: input.action,
      ...(input.resource !== undefined && { resource: input.resource }),
      ...(input.resourceId !== undefined && { resourceId: input.resourceId }),
      ...(input.reason !== undefined && { reason: input.reason }),
      result: "failure",
      error: msg,
    });
    if (!input.skipRevalidate) {
      revalidatePath(input.revalidate ?? tenantPath(input.tenantId));
    }
    return { ok: false, error: msg };
  }
};
