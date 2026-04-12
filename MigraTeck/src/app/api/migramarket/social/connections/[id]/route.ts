import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeSocialConnection } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  platform: z.string().trim().min(1).max(40).optional(),
  handle: z.string().trim().min(2).max(120).optional(),
  profileType: z.string().trim().min(2).max(40).optional(),
  profileUrl: z.string().trim().url().nullable().optional(),
  publishMode: z.string().trim().min(2).max(40).optional(),
  accessModel: z.string().trim().min(2).max(40).optional(),
  status: z.string().trim().min(2).max(40).optional(),
  externalAccountId: z.string().trim().max(160).nullable().optional(),
  scopes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/connections/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketSocialConnection.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const connection = await prisma.migraMarketSocialConnection.update({
    where: { id },
    data: {
      ...(parsed.data.platform !== undefined ? { platform: parsed.data.platform.trim().toLowerCase() } : {}),
      ...(parsed.data.handle !== undefined ? { handle: parsed.data.handle.trim() } : {}),
      ...(parsed.data.profileType !== undefined ? { profileType: parsed.data.profileType.trim().toLowerCase() } : {}),
      ...(parsed.data.profileUrl !== undefined ? { profileUrl: parsed.data.profileUrl || null } : {}),
      ...(parsed.data.publishMode !== undefined ? { publishMode: parsed.data.publishMode.trim().toLowerCase() } : {}),
      ...(parsed.data.accessModel !== undefined ? { accessModel: parsed.data.accessModel.trim().toLowerCase() } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status.trim().toLowerCase() } : {}),
      ...(parsed.data.externalAccountId !== undefined ? { externalAccountId: parsed.data.externalAccountId || null } : {}),
      ...(parsed.data.scopes !== undefined ? { scopes: listToJson(normalizeStringList(parsed.data.scopes)) } : {}),
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_SOCIAL_CONNECTION_UPDATED",
    resourceType: "migramarket_social_connection",
    resourceId: connection.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ connection: serializeSocialConnection(connection) });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/connections/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketSocialConnection.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  await prisma.migraMarketSocialConnection.delete({ where: { id } });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_SOCIAL_CONNECTION_DELETED",
    resourceType: "migramarket_social_connection",
    resourceId: id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ ok: true });
}
