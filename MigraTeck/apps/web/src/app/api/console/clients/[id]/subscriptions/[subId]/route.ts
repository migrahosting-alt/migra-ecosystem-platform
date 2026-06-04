import { requireSession, jsonOk, jsonError, parseJson } from "../../../../../../console/lib/api-helpers";
import { panelExec } from "../../../../../../console/lib/db";
import { withAuditedAction, enqueueProvisioningTask } from "../../../../../../console/lib/modules";

export const dynamic = "force-dynamic";

type Action = "pause" | "resume" | "cancel" | "renew";
type Body = {
  action: Action;
  reason?: string | null;
};

/**
 * POST /api/console/clients/:id/subscriptions/:subId
 * Body: { action: 'pause' | 'resume' | 'cancel' | 'renew', reason?: string }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; subId: string }> },
) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id, subId } = await ctx.params;
  if (!id || !subId) return jsonError(400, "missing_ids");

  const body = await parseJson<Body>(req);
  if (!body || !body.action) return jsonError(400, "missing_action");

  const reason = body.reason?.trim() || null;
  const actor = auth.session.email;

  const runByAction: Record<Action, () => Promise<void>> = {
    pause: async () => {
      await panelExec(`UPDATE subscriptions SET status = 'paused' WHERE id = $1`, [subId]);
    },
    resume: async () => {
      await panelExec(`UPDATE subscriptions SET status = 'active' WHERE id = $1`, [subId]);
    },
    cancel: async () => {
      await panelExec(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [subId]);
    },
    renew: async () => {
      const taskId = await enqueueProvisioningTask({
        tenantId: id,
        serviceInstanceId: subId,
        type: "billing.renew_subscription",
      });
      if (!taskId) throw new Error("Failed to queue subscription renewal");
    },
  };

  const fn = runByAction[body.action];
  if (!fn) return jsonError(400, "invalid_action", { allowed: Object.keys(runByAction) });

  const result = await withAuditedAction({
    tenantId: id,
    actor,
    action: `subscription.${body.action}`,
    resource: "subscription",
    resourceId: subId,
    reason,
    notify: body.action === "cancel",
    run: fn,
  });

  if (!result.ok) return jsonError(500, result.error || "action_failed");
  return jsonOk({ ok: true, action: `subscription.${body.action}` });
}
