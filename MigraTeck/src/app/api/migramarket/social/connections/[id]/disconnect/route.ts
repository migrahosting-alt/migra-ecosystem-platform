import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeSocialConnection } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/connections/[id]/disconnect");
  if (!access.ok) return access.response;

  const { id } = await params;
  const existing = await prisma.migraMarketSocialConnection.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const connection = await prisma.migraMarketSocialConnection.update({
    where: { id },
    data: {
      credentialCiphertext: null,
      refreshTokenCiphertext: null,
      tokenExpiresAt: null,
      lastVerifiedAt: null,
      accessModel: "profile_access",
      status: "draft",
      scopes: Prisma.JsonNull,
      metadata: JSON.parse(
        JSON.stringify({
          ...(existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
            ? existing.metadata
            : {}),
          lastSyncError: null,
        }),
      ),
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_SOCIAL_CONNECTION_DISCONNECTED",
    resourceType: "migramarket_social_connection",
    resourceId: id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
    metadata: {
      platform: connection.platform,
      handle: connection.handle,
    },
  });

  return NextResponse.json({ connection: serializeSocialConnection(connection) });
}
