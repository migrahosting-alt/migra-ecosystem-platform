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

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  fromNumber: z.string().trim().min(10).max(30),
  audienceTag: z.string().trim().max(80).nullable().optional(),
  body: z.string().trim().min(6).max(1200),
  mediaUrls: z.array(z.string().trim().url()).max(5).default([]),
  notes: z.string().max(2000).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult.response;

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) return NextResponse.json({ error: "No active organization." }, { status: 404 });

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/messaging/campaigns",
    ip,
    userAgent,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/messaging/campaigns",
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });

  const campaign = await prisma.migraMarketMessagingCampaign.create({
    data: {
      orgId: activeOrg.orgId,
      name: parsed.data.name,
      fromNumber: normalizeUsPhoneNumber(parsed.data.fromNumber),
      audienceTag: parsed.data.audienceTag?.trim().toLowerCase() || null,
      body: parsed.data.body,
      channel: parsed.data.mediaUrls.length > 0 ? "mms" : "sms",
      mediaUrls: normalizeStringList(parsed.data.mediaUrls),
      notes: parsed.data.notes ?? null,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
    },
  });

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_MESSAGING_CAMPAIGN_CREATED",
    resourceType: "migramarket_messaging_campaign",
    resourceId: campaign.id,
    ip,
    userAgent,
    metadata: {
      name: campaign.name,
      channel: campaign.channel,
      audienceTag: campaign.audienceTag,
    },
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
  }, { status: 201 });
}
