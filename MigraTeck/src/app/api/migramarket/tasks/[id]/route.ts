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
  priority: z.string().trim().min(2).max(40).optional(),
  assignee: z.string().trim().max(120).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
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
    route: "/api/migramarket/tasks/[id]",
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
      route: "/api/migramarket/tasks/[id]",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return { ok: false as const, response: NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } }) };
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { id } = await context.params;
  const existing = await prisma.migraMarketTask.findFirst({
    where: {
      id,
      orgId: activeOrg.orgId,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const nextStatus = parsed.data.status ?? existing.status;
  const completedAt =
    nextStatus === "done" ? existing.completedAt || new Date() : parsed.data.status ? null : existing.completedAt;

  const task = await prisma.migraMarketTask.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.assignee !== undefined ? { assignee: parsed.data.assignee } : {}),
      ...(parsed.data.dueAt !== undefined ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      completedAt,
    },
  });

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_TASK_UPDATED",
    resourceType: "migramarket_task",
    resourceId: task.id,
    ip,
    userAgent,
    metadata: {
      status: task.status,
      priority: task.priority,
      assignee: task.assignee,
      completedAt: task.completedAt,
    },
  });

  return NextResponse.json({ task });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    route: "/api/migramarket/tasks/[id]",
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
      route: "/api/migramarket/tasks/[id]",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return { ok: false as const, response: NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } }) };
  }

  const { id } = await context.params;
  const existing = await prisma.migraMarketTask.findFirst({
    where: { id, orgId: activeOrg.orgId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  await prisma.migraMarketTask.delete({ where: { id } });

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_TASK_DELETED",
    resourceType: "migramarket_task",
    resourceId: id,
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
