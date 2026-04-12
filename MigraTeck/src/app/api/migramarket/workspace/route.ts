import { ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { getMigraMarketWorkspace, listToJson, normalizeStringList, serializePackageTemplate } from "@/lib/migramarket";
import {
  serializeCalendarSlot,
  serializeContentJob,
  serializeContentTemplate,
  serializeCreativeBrief,
  serializeSocialConnection,
} from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

const patchSchema = z.object({
  packageName: z.string().trim().min(2).max(160).nullable().optional(),
  packageTemplateId: z.string().cuid().nullable().optional(),
  clientStage: z.string().trim().min(2).max(60).optional(),
  healthStatus: z.string().trim().min(2).max(60).optional(),
  messagingBrandName: z.string().trim().min(2).max(120).nullable().optional(),
  messagingFromNumber: z.string().trim().min(10).max(30).nullable().optional(),
  messagingSupportEmail: z.string().trim().email().nullable().optional(),
  primaryGoals: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  targetMarkets: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  googleBusinessProfileUrl: z.string().trim().url().nullable().optional(),
  websiteUrl: z.string().trim().url().nullable().optional(),
  socialProfiles: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
  adBudgetMonthly: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

function serializeWorkspace(workspace: Awaited<ReturnType<typeof getMigraMarketWorkspace>>) {
  return {
    account: workspace.account
        ? {
          ...workspace.account,
          primaryGoals: normalizeStringList(workspace.account.primaryGoals),
          targetMarkets: normalizeStringList(workspace.account.targetMarkets),
          socialProfiles: normalizeStringList(workspace.account.socialProfiles),
          packageTemplateCode: workspace.account.packageTemplate?.code || null,
        }
      : null,
    locations: workspace.locations,
    checklist: workspace.checklist,
    tasks: workspace.tasks,
    reports: workspace.reports.map((report: (typeof workspace.reports)[number]) => ({
      ...report,
      periodStart: report.periodStart.toISOString(),
      periodEnd: report.periodEnd.toISOString(),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    })),
    packageTemplates: workspace.packageTemplates.map(serializePackageTemplate),
    leadForms: workspace.leadForms.map((form: (typeof workspace.leadForms)[number]) => ({
      ...form,
      createdAt: form.createdAt.toISOString(),
      updatedAt: form.updatedAt.toISOString(),
    })),
    leads: workspace.leads.map((lead: (typeof workspace.leads)[number]) => ({
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
    })),
    messagingCampaigns: workspace.messagingCampaigns.map((campaign: (typeof workspace.messagingCampaigns)[number]) => ({
      ...campaign,
      mediaUrls: normalizeStringList(campaign.mediaUrls),
      scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null,
      launchedAt: campaign.launchedAt ? campaign.launchedAt.toISOString() : null,
      completedAt: campaign.completedAt ? campaign.completedAt.toISOString() : null,
      lastDispatchedAt: campaign.lastDispatchedAt ? campaign.lastDispatchedAt.toISOString() : null,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    })),
    recentDeliveries: workspace.recentDeliveries.map((delivery: (typeof workspace.recentDeliveries)[number]) => ({
      ...delivery,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
      deliveredAt: delivery.deliveredAt ? delivery.deliveredAt.toISOString() : null,
      finalizedAt: delivery.finalizedAt ? delivery.finalizedAt.toISOString() : null,
      campaign: delivery.campaign
        ? {
            id: delivery.campaign.id,
            name: delivery.campaign.name,
          }
        : null,
      lead: delivery.lead
        ? {
            id: delivery.lead.id,
            fullName: delivery.lead.fullName,
            phone: delivery.lead.phone,
          }
        : null,
    })),
    socialConnections: workspace.socialConnections.map((connection: (typeof workspace.socialConnections)[number]) =>
      serializeSocialConnection(connection),
    ),
    creativeBriefs: workspace.creativeBriefs.map((brief: (typeof workspace.creativeBriefs)[number]) =>
      serializeCreativeBrief(brief),
    ),
    contentJobs: workspace.contentJobs.map((job: (typeof workspace.contentJobs)[number]) => serializeContentJob(job)),
    contentTemplates: workspace.contentTemplates.map((template: (typeof workspace.contentTemplates)[number]) =>
      serializeContentTemplate(template),
    ),
    calendarSlots: workspace.calendarSlots.map((slot: (typeof workspace.calendarSlots)[number]) => serializeCalendarSlot(slot)),
  };
}

export async function GET(request: NextRequest) {
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
    action: "org:entitlement:view",
    route: "/api/migramarket/workspace",
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
      route: "/api/migramarket/workspace",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return { ok: false as const, response: NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } }) };
  }

  const workspace = await getMigraMarketWorkspace(activeOrg.orgId);

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_WORKSPACE_VIEWED",
    resourceType: "migramarket_workspace",
    resourceId: activeOrg.orgId,
    ip,
    userAgent,
    riskTier: 0,
  });

  return NextResponse.json({
    workspace: serializeWorkspace(workspace),
    role: activeOrg.role,
    org: {
      id: activeOrg.org.id,
      name: activeOrg.org.name,
      slug: activeOrg.org.slug,
    },
  });
}

export async function PATCH(request: NextRequest) {
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
    route: "/api/migramarket/workspace",
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
      route: "/api/migramarket/workspace",
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

  const payload = parsed.data;
  await prisma.migraMarketAccount.upsert({
    where: { orgId: activeOrg.orgId },
    update: {
      ...(payload.packageName !== undefined ? { packageName: payload.packageName } : {}),
      ...(payload.packageTemplateId !== undefined ? { packageTemplateId: payload.packageTemplateId } : {}),
      ...(payload.clientStage !== undefined ? { clientStage: payload.clientStage } : {}),
      ...(payload.healthStatus !== undefined ? { healthStatus: payload.healthStatus } : {}),
      ...(payload.messagingBrandName !== undefined ? { messagingBrandName: payload.messagingBrandName } : {}),
      ...(payload.messagingFromNumber !== undefined ? { messagingFromNumber: payload.messagingFromNumber } : {}),
      ...(payload.messagingSupportEmail !== undefined ? { messagingSupportEmail: payload.messagingSupportEmail } : {}),
      ...(payload.primaryGoals !== undefined ? { primaryGoals: listToJson(payload.primaryGoals) } : {}),
      ...(payload.targetMarkets !== undefined ? { targetMarkets: listToJson(payload.targetMarkets) } : {}),
      ...(payload.googleBusinessProfileUrl !== undefined
        ? { googleBusinessProfileUrl: payload.googleBusinessProfileUrl }
        : {}),
      ...(payload.websiteUrl !== undefined ? { websiteUrl: payload.websiteUrl } : {}),
      ...(payload.socialProfiles !== undefined ? { socialProfiles: listToJson(payload.socialProfiles) } : {}),
      ...(payload.adBudgetMonthly !== undefined ? { adBudgetMonthly: payload.adBudgetMonthly } : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
    },
    create: {
      orgId: activeOrg.orgId,
      packageName: payload.packageName ?? null,
      packageTemplateId: payload.packageTemplateId ?? null,
      clientStage: payload.clientStage || "onboarding",
      healthStatus: payload.healthStatus || "needs_attention",
      messagingBrandName: payload.messagingBrandName ?? null,
      messagingFromNumber: payload.messagingFromNumber ?? null,
      messagingSupportEmail: payload.messagingSupportEmail ?? null,
      primaryGoals: payload.primaryGoals ? listToJson(payload.primaryGoals) : undefined,
      targetMarkets: payload.targetMarkets ? listToJson(payload.targetMarkets) : undefined,
      googleBusinessProfileUrl: payload.googleBusinessProfileUrl ?? null,
      websiteUrl: payload.websiteUrl ?? null,
      socialProfiles: payload.socialProfiles ? listToJson(payload.socialProfiles) : undefined,
      adBudgetMonthly: payload.adBudgetMonthly ?? null,
      notes: payload.notes ?? null,
    },
  });

  const workspace = await getMigraMarketWorkspace(activeOrg.orgId);

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_WORKSPACE_UPDATED",
    resourceType: "migramarket_workspace",
    resourceId: activeOrg.orgId,
    ip,
    userAgent,
    metadata: {
      fields: Object.keys(payload),
    },
  });

  return NextResponse.json({
    workspace: serializeWorkspace(workspace),
  });
}
