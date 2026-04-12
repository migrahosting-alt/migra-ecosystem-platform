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

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  sourceChannel: z.string().trim().min(2).max(80).default("manual"),
  campaign: z.string().trim().max(160).nullable().optional(),
  landingPage: z.string().trim().max(240).nullable().optional(),
  status: z.string().trim().min(2).max(40).default("new"),
  valueEstimate: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  smsConsentStatus: z.enum(["unknown", "subscribed", "unsubscribed"]).default("unknown"),
  smsConsentSource: z.string().trim().max(160).nullable().optional(),
  smsConsentEvidence: z.string().trim().max(500).nullable().optional(),
  messagingTags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
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
    route: "/api/migramarket/leads",
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
      route: "/api/migramarket/leads",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const lead = await prisma.migraMarketLeadRecord.create({
    data: {
      orgId: activeOrg.orgId,
      fullName: parsed.data.fullName,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ? normalizeUsPhoneNumber(parsed.data.phone) : null,
      company: parsed.data.company ?? null,
      sourceChannel: parsed.data.sourceChannel,
      campaign: parsed.data.campaign ?? null,
      landingPage: parsed.data.landingPage ?? null,
      status: parsed.data.status,
      valueEstimate: parsed.data.valueEstimate ?? null,
      notes: parsed.data.notes ?? null,
      smsConsentStatus: parsed.data.smsConsentStatus,
      smsConsentAt: parsed.data.smsConsentStatus === "subscribed" ? new Date() : null,
      smsConsentSource: parsed.data.smsConsentSource ?? null,
      smsConsentEvidence: parsed.data.smsConsentEvidence ?? null,
      smsOptedOutAt: parsed.data.smsConsentStatus === "unsubscribed" ? new Date() : null,
      messagingTags: parsed.data.messagingTags.length > 0 ? normalizeMessagingTags(parsed.data.messagingTags) : Prisma.JsonNull,
      metadata: {
        capturedBy: "manual",
      } as Prisma.InputJsonValue,
    },
    include: {
      form: true,
    },
  });

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_LEAD_CREATED",
    resourceType: "migramarket_lead",
    resourceId: lead.id,
    ip,
    userAgent,
    metadata: {
      sourceChannel: lead.sourceChannel,
      status: lead.status,
      email: lead.email,
      smsConsentStatus: lead.smsConsentStatus,
    },
  });

  return NextResponse.json({
    lead: {
      ...lead,
      messagingTags: normalizeStringList(lead.messagingTags),
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
      smsConsentAt: lead.smsConsentAt ? lead.smsConsentAt.toISOString() : null,
      smsOptedOutAt: lead.smsOptedOutAt ? lead.smsOptedOutAt.toISOString() : null,
      form: lead.form
        ? {
            ...lead.form,
            createdAt: lead.form.createdAt.toISOString(),
            updatedAt: lead.form.updatedAt.toISOString(),
          }
        : null,
    },
  }, { status: 201 });
}
