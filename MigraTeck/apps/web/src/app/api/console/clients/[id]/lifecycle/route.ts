import { requireSession, jsonOk, jsonError, parseJson, jsonToFormData } from "../../../../../console/lib/api-helpers";
import { panelExec } from "../../../../../console/lib/db";
import {
  withAuditedAction,
  enqueueProvisioningTask,
} from "../../../../../console/lib/modules";

export const dynamic = "force-dynamic";

type Action = "activate" | "suspend" | "cancel" | "resume" | "renew";
type Body = {
  action: Action;
  reason?: string | null;
};

/**
 * POST /api/console/clients/:id/lifecycle
 * Body: { action: 'activate' | 'suspend' | 'cancel' | 'resume' | 'renew', reason?: string }
 *
 * Mirrors the UI lifecycle buttons. Audited the same way. Caller is identified
 * by the session cookie (admin@migrateck.com etc).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!id) return jsonError(400, "missing_id");

  const body = await parseJson<Body>(req);
  if (!body || !body.action) return jsonError(400, "missing_action");

  const reason = body.reason?.trim() || null;
  const actor = auth.session.email;

  // Reuse the same withAuditedAction wrapper the UI uses so audit + notify
  // semantics are identical regardless of caller (UI form vs API).
  const runByAction: Record<Action, () => Promise<void>> = {
    activate: async () => {
      await panelExec(
        `UPDATE tenants SET status = 'active', is_active = TRUE, deleted_at = NULL, updated_at = NOW() WHERE id = $1`,
        [id],
      );
    },
    suspend: async () => {
      await panelExec(
        `UPDATE tenants SET status = 'suspended', is_active = FALSE, updated_at = NOW() WHERE id = $1`,
        [id],
      );
      await panelExec(
        `UPDATE subscriptions SET status = 'paused' WHERE tenantid = $1 AND status IN ('active','trialing')`,
        [id],
      ).catch((e) => console.error("[api lifecycle suspend] cascade subs failed", e));
    },
    cancel: async () => {
      await panelExec(
        `UPDATE tenants SET status = 'churned', is_active = FALSE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id],
      );
      await panelExec(
        `UPDATE subscriptions SET status = 'cancelled' WHERE tenantid = $1 AND status IN ('active','trialing','paused')`,
        [id],
      ).catch((e) => console.error("[api lifecycle cancel] cascade subs failed", e));
    },
    resume: async () => {
      await panelExec(
        `UPDATE tenants SET status = 'active', is_active = TRUE, updated_at = NOW() WHERE id = $1`,
        [id],
      );
      await panelExec(
        `UPDATE subscriptions SET status = 'active' WHERE tenantid = $1 AND status = 'paused'`,
        [id],
      ).catch((e) => console.error("[api lifecycle resume] cascade subs failed", e));
    },
    renew: async () => {
      const taskId = await enqueueProvisioningTask({
        tenantId: id,
        type: "billing.renew_tenant",
      });
      if (!taskId) throw new Error("Failed to queue renewal task");
    },
  };

  const fn = runByAction[body.action];
  if (!fn) return jsonError(400, "invalid_action", { allowed: Object.keys(runByAction) });

  const result = await withAuditedAction({
    tenantId: id,
    actor,
    action: `tenant.${body.action}`,
    resource: "tenant",
    resourceId: id,
    reason,
    notify: body.action === "suspend" || body.action === "cancel" || body.action === "resume",
    run: fn,
  });

  // We accept the jsonToFormData re-export pattern even though we don't use
  // it here — keeping the helper available for routes that might.
  void jsonToFormData;

  if (!result.ok) return jsonError(500, result.error || "action_failed");
  return jsonOk({ ok: true, action: `tenant.${body.action}` });
}
