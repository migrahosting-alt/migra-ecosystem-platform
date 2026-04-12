import { ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { normalizeStringList } from "@/lib/migramarket";
import { normalizeUsPhoneNumber } from "@/lib/migramarket-messaging";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  fromNumber: z.string().trim().min(10).max(30).optional(),
  audienceTag: z.string().trim().max(80).nullable().optional(),
  body: z.string().trim().min(6).max(1200).optional(),
  mediaUrls: z.array(z.string().trim().url()).max(5).optional(),
  notes: z.string().max(2000).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  status: z.enum(["draft", "scheduled", "paused"]).optional(),
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
    route: "/api/migramarket/messaging/campaigns/[id]",
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
      route: "/api/migramarket/messaging/campaigns/[id]",
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
  const existing = await prisma.migraMarketMessagingCampaign.findFirst({ where: { id, orgId: auth.activeOrg.orgId } });
  if (!existing) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const campaign = await prisma.migraMarketMessagingCampaign.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.fromNumber !== undefined ? { fromNumber: normalizeUsPhoneNumber(parsed.data.fromNumber) } : {}),
      ...(parsed.data.audienceTag !== undefined ? { audienceTag: parsed.data.audienceTag?.trim().toLowerCase() || null } : {}),
      ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      ...(parsed.data.mediaUrls !== undefined
        ? {
            mediaUrls: normalizeStringList(parsed.data.mediaUrls),
            channel: parsed.data.mediaUrls.length > 0 ? "mms" : "sms",
          }
        : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes ?? null } : {}),
      ...(parsed.data.scheduledAt !== undefined
        ? { scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null }
        : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    },
  });

  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "MIGRAMARKET_MESSAGING_CAMPAIGN_UPDATED",
    resourceType: "migramarket_messaging_campaign",
    resourceId: id,
    ip: auth.ip,
    userAgent: auth.userAgent,
    metadata: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json({
    campaign: {
      ...campaign,
      mediaUrls: normalizeStringList(campaign.mediaUrls),
      scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null,
      launchedAt: campaign.launchedAt ? campaign.launchedAt.toISOString() : null,
      completedAt: campaign.completedAt ? campaign.completedAt.toISOString() : null,
      lastDispatchedAt: campaign.lastDispatchedAt ? campaign.lastDispatchedAt.toISOString() : null,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const existing = await prisma.migraMarketMessagingCampaign.findFirst({ where: { id, orgId: auth.activeOrg.orgId } });
  if (!existing) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  await prisma.migraMarketMessagingCampaign.delete({ where: { id } });

  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "MIGRAMARKET_MESSAGING_CAMPAIGN_DELETED",
    resourceType: "migramarket_messaging_campaign",
    resourceId: id,
    ip: auth.ip,
    userAgent: auth.userAgent,
  });

  return NextResponse.json({ ok: true });
}
