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
  label: z.string().trim().min(2).max(120).optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  leads: z.number().int().nonnegative().optional(),
  calls: z.number().int().nonnegative().optional(),
  bookedAppointments: z.number().int().nonnegative().optional(),
  profileViews: z.number().int().nonnegative().optional(),
  websiteSessions: z.number().int().nonnegative().optional(),
  conversionRate: z.number().nonnegative().nullable().optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  averageRating: z.number().min(0).max(5).nullable().optional(),
  emailOpenRate: z.number().min(0).max(100).nullable().optional(),
  socialReach: z.number().int().nonnegative().optional(),
  adSpend: z.number().nonnegative().nullable().optional(),
  costPerLead: z.number().nonnegative().nullable().optional(),
  revenueAttributed: z.number().nonnegative().nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
});

async function authorize(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult;
  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) return { ok: false as const, response: NextResponse.json({ error: "No active organization." }, { status: 404 }) };
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/reports/[id]",
    ip,
    userAgent,
  });
  if (!allowed) return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/reports/[id]",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return { ok: false as const, response: NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus }) };
    }
    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return { ok: false as const, response: NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } }) };
  }
  return { ok: true as const, authResult, activeOrg, ip, userAgent };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  const existing = await prisma.migraMarketReportSnapshot.findFirst({ where: { id, orgId: auth.activeOrg.orgId } });
  if (!existing) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  const updateData = {
    ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
    ...(parsed.data.periodStart !== undefined ? { periodStart: new Date(parsed.data.periodStart) } : {}),
    ...(parsed.data.periodEnd !== undefined ? { periodEnd: new Date(parsed.data.periodEnd) } : {}),
    ...(parsed.data.leads !== undefined ? { leads: parsed.data.leads } : {}),
    ...(parsed.data.calls !== undefined ? { calls: parsed.data.calls } : {}),
    ...(parsed.data.bookedAppointments !== undefined ? { bookedAppointments: parsed.data.bookedAppointments } : {}),
    ...(parsed.data.profileViews !== undefined ? { profileViews: parsed.data.profileViews } : {}),
    ...(parsed.data.websiteSessions !== undefined ? { websiteSessions: parsed.data.websiteSessions } : {}),
    ...(parsed.data.conversionRate !== undefined ? { conversionRate: parsed.data.conversionRate } : {}),
    ...(parsed.data.reviewCount !== undefined ? { reviewCount: parsed.data.reviewCount } : {}),
    ...(parsed.data.averageRating !== undefined ? { averageRating: parsed.data.averageRating } : {}),
    ...(parsed.data.emailOpenRate !== undefined ? { emailOpenRate: parsed.data.emailOpenRate } : {}),
    ...(parsed.data.socialReach !== undefined ? { socialReach: parsed.data.socialReach } : {}),
    ...(parsed.data.adSpend !== undefined ? { adSpend: parsed.data.adSpend } : {}),
    ...(parsed.data.costPerLead !== undefined ? { costPerLead: parsed.data.costPerLead } : {}),
    ...(parsed.data.revenueAttributed !== undefined ? { revenueAttributed: parsed.data.revenueAttributed } : {}),
    ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
  };
  const report = await prisma.migraMarketReportSnapshot.update({
    where: { id },
    data: updateData,
  });
  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "MIGRAMARKET_REPORT_UPDATED",
    resourceType: "migramarket_report_snapshot",
    resourceId: report.id,
    ip: auth.ip,
    userAgent: auth.userAgent,
    metadata: { fields: Object.keys(parsed.data) },
  });
  return NextResponse.json({ report: { ...report, periodStart: report.periodStart.toISOString(), periodEnd: report.periodEnd.toISOString(), createdAt: report.createdAt.toISOString(), updatedAt: report.updatedAt.toISOString() } });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const existing = await prisma.migraMarketReportSnapshot.findFirst({ where: { id, orgId: auth.activeOrg.orgId } });
  if (!existing) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  await prisma.migraMarketReportSnapshot.delete({ where: { id } });
  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "MIGRAMARKET_REPORT_DELETED",
    resourceType: "migramarket_report_snapshot",
    resourceId: id,
    ip: auth.ip,
    userAgent: auth.userAgent,
  });
  return NextResponse.json({ ok: true });
}
