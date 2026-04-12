import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeSocialConnection } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  platform: z.string().trim().min(1).max(40),
  handle: z.string().trim().min(2).max(120),
  profileType: z.string().trim().min(2).max(40).default("business"),
  profileUrl: z.string().trim().url().nullable().optional(),
  publishMode: z.string().trim().min(2).max(40).default("assisted"),
  accessModel: z.string().trim().min(2).max(40).default("profile_access"),
  status: z.string().trim().min(2).max(40).default("draft"),
  externalAccountId: z.string().trim().max(160).nullable().optional(),
  scopes: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
});

export async function POST(request: NextRequest) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/connections");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const connection = await prisma.migraMarketSocialConnection.create({
    data: {
      orgId: access.context.activeOrg.orgId,
      platform: parsed.data.platform.trim().toLowerCase(),
      handle: parsed.data.handle.trim(),
      profileType: parsed.data.profileType.trim().toLowerCase(),
      profileUrl: parsed.data.profileUrl || null,
      publishMode: parsed.data.publishMode.trim().toLowerCase(),
      accessModel: parsed.data.accessModel.trim().toLowerCase(),
      status: parsed.data.status.trim().toLowerCase(),
      externalAccountId: parsed.data.externalAccountId || null,
      scopes: listToJson(normalizeStringList(parsed.data.scopes)),
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_SOCIAL_CONNECTION_CREATED",
    resourceType: "migramarket_social_connection",
    resourceId: connection.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
    metadata: {
      platform: connection.platform,
      handle: connection.handle,
      publishMode: connection.publishMode,
    },
  });

  return NextResponse.json({ connection: serializeSocialConnection(connection) }, { status: 201 });
}
