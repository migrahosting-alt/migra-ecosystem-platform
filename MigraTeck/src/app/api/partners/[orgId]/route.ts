import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { approvePartner, suspendPartner, revokePartner } from "@/lib/partners";

type RouteContext = { params: Promise<{ orgId: string }> };

export async function PATCH(request: NextRequest, props: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { orgId } = await props.params;
  const body = await request.json();
  const action = body.action as "approve" | "suspend" | "revoke";

  if (action === "approve") {
    const result = await approvePartner(orgId);
    return NextResponse.json({ partner: result });
  }
  if (action === "suspend") {
    const result = await suspendPartner(orgId);
    return NextResponse.json({ partner: result });
  }
  if (action === "revoke") {
    const result = await revokePartner(orgId);
    return NextResponse.json({ partner: result });
  }

  return NextResponse.json({ error: "Invalid action." }, { status: 400 });
}
