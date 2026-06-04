import { requireSession, jsonOk, jsonError } from "../../../../console/lib/api-helpers";
import { loadClientDetail, loadFailedTasksForTenant } from "../../../../console/lib/modules";

export const dynamic = "force-dynamic";

/**
 * GET /api/console/clients/:id
 * Full detail for one tenant (subscriptions, invoices, mailboxes, websites,
 * domains, failed provisioning tasks).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!id) return jsonError(400, "missing_id");

  const [detail, failedTasks] = await Promise.all([
    loadClientDetail(id),
    loadFailedTasksForTenant(id, 25),
  ]);

  if (!detail) return jsonError(404, "not_found");
  return jsonOk({ ...detail, failedTasks });
}
