"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "../../lib/auth";
import { getPaleRole, canMutateReports } from "../../lib/pale-rbac";
import { markReportReviewing } from "../../lib/pale-admin";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Phase 2A server action: mark a report "reviewing" through the audited pale-api
 * bridge. RBAC is enforced here (server-side) AND again by pale-api's RolesGuard.
 * No direct DB write. Returns a safe result for the client modal.
 */
export async function markReviewingAction(reportId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authenticated." };

  const role = getPaleRole(session);
  if (!canMutateReports(role)) {
    return { ok: false, error: "Your role cannot mark reports reviewing." };
  }

  if (typeof reportId !== "string" || !/^[0-9a-f-]{8,}$/i.test(reportId)) {
    return { ok: false, error: "Invalid report id." };
  }

  const result = await markReportReviewing(reportId, session.email, role);
  if (result.ok) {
    revalidatePath("/console/pale/reports");
    revalidatePath("/console/pale");
    return { ok: true };
  }
  return { ok: false, error: result.error };
}
