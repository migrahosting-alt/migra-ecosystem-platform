import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization" }, { status: 403 });
  }

  if (!can(ctx.role, "audit:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const actorId = url.searchParams.get("actorId");
  const action = url.searchParams.get("action");
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const cursor = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");

  const limit = Math.min(Math.max(Number(limitParam) || 50, 1), 200);

  const where: Prisma.AuditLogWhereInput = {
    orgId: ctx.orgId,
  };

  if (actorId) where.userId = actorId;
  if (action) where.action = { contains: action, mode: "insensitive" };
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;

  if (since || until) {
    where.createdAt = {};
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) where.createdAt.gte = sinceDate;
    }
    if (until) {
      const untilDate = new Date(until);
      if (!isNaN(untilDate.getTime())) where.createdAt.lte = untilDate;
    }
  }

  const events = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      action: true,
      entityType: true,
      entityId: true,
      ip: true,
      metadata: true,
      createdAt: true,
    },
  });

  const hasMore = events.length > limit;
  const items = hasMore ? events.slice(0, limit) : events;
  const nextCursor = hasMore ? items[items.length - 1]?.id : null;

  return NextResponse.json({
    ok: true,
    data: {
      items,
      nextCursor,
      hasMore,
    },
  });
}
