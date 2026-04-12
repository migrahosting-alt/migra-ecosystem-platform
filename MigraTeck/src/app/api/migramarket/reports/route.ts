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

const createSchema = z.object({
  label: z.string().trim().min(2).max(120),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  leads: z.number().int().nonnegative().default(0),
  calls: z.number().int().nonnegative().default(0),
  bookedAppointments: z.number().int().nonnegative().default(0),
  profileViews: z.number().int().nonnegative().default(0),
  websiteSessions: z.number().int().nonnegative().default(0),
  conversionRate: z.number().nonnegative().nullable().optional(),
  reviewCount: z.number().int().nonnegative().default(0),
  averageRating: z.number().min(0).max(5).nullable().optional(),
  emailOpenRate: z.number().min(0).max(100).nullable().optional(),
  socialReach: z.number().int().nonnegative().default(0),
  adSpend: z.number().nonnegative().nullable().optional(),
  costPerLead: z.number().nonnegative().nullable().optional(),
  revenueAttributed: z.number().nonnegative().nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
});

export async function POST(request: NextRequest) {
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
    route: "/api/migramarket/reports",
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
      route: "/api/migramarket/reports",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return { ok: false as const, response: NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } }) };
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const report = await prisma.migraMarketReportSnapshot.create({
    data: {
      orgId: activeOrg.orgId,
      ...parsed.data,
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
    },
  });

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_REPORT_CREATED",
    resourceType: "migramarket_report_snapshot",
    resourceId: report.id,
    ip,
    userAgent,
    metadata: {
      label: report.label,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      leads: report.leads,
      calls: report.calls,
    },
  });

  return NextResponse.json({ report }, { status: 201 });
}
