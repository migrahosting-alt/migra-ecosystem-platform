import { ProductKey, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { normalizeMessagingTags, normalizeUsPhoneNumber } from "@/lib/migramarket-messaging";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";
import { normalizeStringList } from "@/lib/migramarket";

const patchSchema = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  sourceChannel: z.string().trim().min(2).max(80).optional(),
  campaign: z.string().trim().max(160).nullable().optional(),
  landingPage: z.string().trim().max(240).nullable().optional(),
  status: z.string().trim().min(2).max(40).optional(),
  valueEstimate: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  smsConsentStatus: z.enum(["unknown", "subscribed", "unsubscribed"]).optional(),
  smsConsentSource: z.string().trim().max(160).nullable().optional(),
  smsConsentEvidence: z.string().trim().max(500).nullable().optional(),
  messagingTags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
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
    route: "/api/migramarket/leads/[id]",
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
      route: "/api/migramarket/leads/[id]",
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
  const existing = await prisma.migraMarketLeadRecord.findFirst({ where: { id, orgId: auth.activeOrg.orgId }, include: { form: true } });
  if (!existing) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const lead = await prisma.migraMarketLeadRecord.update({
    where: { id },
    data: {
      ...(parsed.data.fullName !== undefined ? { fullName: parsed.data.fullName } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone ? normalizeUsPhoneNumber(parsed.data.phone) : null } : {}),
      ...(parsed.data.company !== undefined ? { company: parsed.data.company } : {}),
      ...(parsed.data.sourceChannel !== undefined ? { sourceChannel: parsed.data.sourceChannel } : {}),
      ...(parsed.data.campaign !== undefined ? { campaign: parsed.data.campaign } : {}),
      ...(parsed.data.landingPage !== undefined ? { landingPage: parsed.data.landingPage } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.valueEstimate !== undefined ? { valueEstimate: parsed.data.valueEstimate } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.smsConsentStatus !== undefined
        ? {
            smsConsentStatus: parsed.data.smsConsentStatus,
            smsConsentAt:
              parsed.data.smsConsentStatus === "subscribed" ? existing.smsConsentAt || new Date() : existing.smsConsentAt,
            smsOptedOutAt:
              parsed.data.smsConsentStatus === "unsubscribed"
                ? existing.smsOptedOutAt || new Date()
                : parsed.data.smsConsentStatus === "subscribed"
                  ? null
                  : existing.smsOptedOutAt,
          }
        : {}),
      ...(parsed.data.smsConsentSource !== undefined ? { smsConsentSource: parsed.data.smsConsentSource } : {}),
      ...(parsed.data.smsConsentEvidence !== undefined ? { smsConsentEvidence: parsed.data.smsConsentEvidence } : {}),
      ...(parsed.data.messagingTags !== undefined
        ? { messagingTags: normalizeMessagingTags(parsed.data.messagingTags) }
        : {}),
      metadata: {
        ...(typeof existing.metadata === "object" && existing.metadata && !Array.isArray(existing.metadata) ? (existing.metadata as Record<string, unknown>) : {}),
        updatedBy: "workspace",
      } as Prisma.InputJsonValue,
    },
    include: { form: true },
  });
  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "MIGRAMARKET_LEAD_UPDATED",
    resourceType: "migramarket_lead",
    resourceId: id,
    ip: auth.ip,
    userAgent: auth.userAgent,
    metadata: { fields: Object.keys(parsed.data), status: lead.status },
  });
  return NextResponse.json({
    lead: {
      ...lead,
      messagingTags: normalizeStringList(lead.messagingTags),
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
      smsConsentAt: lead.smsConsentAt ? lead.smsConsentAt.toISOString() : null,
      smsOptedOutAt: lead.smsOptedOutAt ? lead.smsOptedOutAt.toISOString() : null,
      form: lead.form ? { ...lead.form, createdAt: lead.form.createdAt.toISOString(), updatedAt: lead.form.updatedAt.toISOString() } : null,
    },
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const existing = await prisma.migraMarketLeadRecord.findFirst({ where: { id, orgId: auth.activeOrg.orgId } });
  if (!existing) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  await prisma.migraMarketLeadRecord.delete({ where: { id } });
  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "MIGRAMARKET_LEAD_DELETED",
    resourceType: "migramarket_lead",
    resourceId: id,
    ip: auth.ip,
    userAgent: auth.userAgent,
  });
  return NextResponse.json({ ok: true });
}
