import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { updateBundlePlan, deleteBundlePlan } from "@/lib/billing/bundles";
import { ProductKey } from "@prisma/client";

type RouteContext = { params: Promise<{ bundleId: string }> };

export async function PATCH(request: NextRequest, props: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { bundleId } = await props.params;
  const body = await request.json();

  const bundle = await updateBundlePlan(bundleId, body);
  return NextResponse.json({ bundle });
}

export async function DELETE(_request: NextRequest, props: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { bundleId } = await props.params;
  await deleteBundlePlan(bundleId);
  return NextResponse.json({ ok: true });
}
