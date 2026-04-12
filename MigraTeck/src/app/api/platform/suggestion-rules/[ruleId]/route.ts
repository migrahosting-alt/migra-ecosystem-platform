import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { updateSuggestionRule, deleteSuggestionRule } from "@/lib/suggestions";

type RouteContext = { params: Promise<{ ruleId: string }> };

export async function PATCH(request: NextRequest, props: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { ruleId } = await props.params;
  const body = await request.json();

  const rule = await updateSuggestionRule(ruleId, body);
  return NextResponse.json({ rule });
}

export async function DELETE(_request: NextRequest, props: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { ruleId } = await props.params;
  await deleteSuggestionRule(ruleId);
  return NextResponse.json({ ok: true });
}
