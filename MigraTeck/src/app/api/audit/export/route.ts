import { MembershipStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { getActiveOrgContext } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { assertRateLimit } from "@/lib/security/rate-limit";

const querySchema = z.object({
  orgId: z.string().min(10).optional(),
  format: z.enum(["csv", "json"]).default("json"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function toCsvValue(input: unknown): string {
  const raw = input == null ? "" : typeof input === "string" ? input : JSON.stringify(input);
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const parsed = querySchema.safeParse({
    orgId: request.nextUrl.searchParams.get("orgId") || undefined,
    format: request.nextUrl.searchParams.get("format") || "json",
    from: request.nextUrl.searchParams.get("from") || undefined,
    to: request.nextUrl.searchParams.get("to") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query." }, { status: 400 });
  }

  let targetOrgId = parsed.data.orgId;

  if (!targetOrgId) {
    const activeOrg = await getActiveOrgContext(actorUserId);
    if (!activeOrg) {
      return NextResponse.json({ error: "No active organization." }, { status: 400 });
    }
    targetOrgId = activeOrg.orgId;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: actorUserId,
      orgId: targetOrgId,
      status: MembershipStatus.ACTIVE,
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId: targetOrgId,
    role: membership.role,
    action: "audit:export",
    route: "/api/audit/export",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${targetOrgId}:${ip}`,
    action: "audit:export",
    maxAttempts: 20,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const from = parsed.data.from ? new Date(parsed.data.from) : null;
  const to = parsed.data.to ? new Date(parsed.data.to) : null;

  const events = await prisma.auditLog.findMany({
    where: {
      orgId: targetOrgId,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  await writeAuditLog({
    userId: actorUserId,
    orgId: targetOrgId,
    action: "AUDIT_EXPORT_CREATED",
    entityType: "audit_export",
    entityId: parsed.data.format,
    ip,
    userAgent,
    metadata: {
      format: parsed.data.format,
      from,
      to,
      count: events.length,
    },
  });

  const filename = `audit-export-${targetOrgId}-${Date.now()}.${parsed.data.format}`;

  if (parsed.data.format === "json") {
    return new NextResponse(JSON.stringify(events), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const header = ["id", "createdAt", "action", "userId", "orgId", "entityType", "entityId", "ip", "userAgent", "metadata"];
  const rows = events.map((event) =>
    [
      event.id,
      event.createdAt.toISOString(),
      event.action,
      event.userId || "",
      event.orgId || "",
      event.entityType || "",
      event.entityId || "",
      event.ip || "",
      event.userAgent || "",
      event.metadata || "",
    ]
      .map(toCsvValue)
      .join(","),
  );

  const csv = `${header.join(",")}\n${rows.join("\n")}`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
