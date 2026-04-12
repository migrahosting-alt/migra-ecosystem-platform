import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can, type PermissionAction } from "@/lib/rbac";

export async function requireComplianceReportPermission(action: PermissionAction) {
  const auth = await requireApiSession();
  if (!auth.ok) {
    return { ok: false as const, response: auth.response };
  }

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, action)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    session: auth.session,
    ctx,
  };
}