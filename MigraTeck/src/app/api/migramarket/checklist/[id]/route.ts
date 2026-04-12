import { ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

const patchSchema = z.object({
  status: z.string().trim().min(2).max(40).optional(),
  owner: z.string().trim().max(120).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return NextResponse.json({ error: "No active organization." }, { status: 404 });
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/checklist/[id]",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/checklist/[id]",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { id } = await context.params;
  const existing = await prisma.migraMarketChecklistItem.findFirst({
    where: {
      id,
      orgId: activeOrg.orgId,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Checklist item not found." }, { status: 404 });
  }

  const nextStatus = parsed.data.status ?? existing.status;
  const completedAt =
    nextStatus === "completed" ? existing.completedAt || new Date() : parsed.data.status ? null : existing.completedAt;

  const item = await prisma.migraMarketChecklistItem.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.owner !== undefined ? { owner: parsed.data.owner } : {}),
      ...(parsed.data.dueAt !== undefined ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null } : {}),
      completedAt,
    },
  });

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_CHECKLIST_UPDATED",
    resourceType: "migramarket_checklist_item",
    resourceId: item.id,
    ip,
    userAgent,
    metadata: {
      status: item.status,
      owner: item.owner,
      completedAt: item.completedAt,
    },
  });

  return NextResponse.json({ item });
}
