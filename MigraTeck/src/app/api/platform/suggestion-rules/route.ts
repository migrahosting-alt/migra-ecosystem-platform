import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import {
  listSuggestionRules,
  createSuggestionRule,
} from "@/lib/suggestions";
import { SuggestionTrigger, ProductKey, Prisma } from "@prisma/client";

export async function GET(_request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const rules = await listSuggestionRules(false);
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();

  const rule = await createSuggestionRule({
    name: body.name,
    description: body.description,
    trigger: body.trigger as SuggestionTrigger,
    sourceProduct: body.sourceProduct as ProductKey | undefined,
    targetProduct: body.targetProduct as ProductKey,
    priority: body.priority,
    title: body.title,
    body: body.body,
    actionLabel: body.actionLabel,
    actionUrl: body.actionUrl,
    conditions: body.conditions as Prisma.InputJsonValue | undefined,
    maxPerOrg: body.maxPerOrg,
  });

  return NextResponse.json({ rule }, { status: 201 });
}
