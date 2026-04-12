import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeSocialConnection } from "@/lib/migramarket-social";
import { syncSocialConnectionForOrg } from "@/lib/migramarket-social-publisher";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/connections/[id]/sync");
  if (!access.ok) return access.response;

  const { id } = await params;

  try {
    const { connection } = await syncSocialConnectionForOrg(access.context.activeOrg.orgId, id);

    await writeAuditLog({
      actorId: access.context.session.user.id,
      actorRole: access.context.activeOrg.role,
      orgId: access.context.activeOrg.orgId,
      action: "MIGRAMARKET_SOCIAL_CONNECTION_SYNCED",
      resourceType: "migramarket_social_connection",
      resourceId: connection.id,
      ip: access.context.ip,
      userAgent: access.context.userAgent,
      metadata: {
        platform: connection.platform,
        handle: connection.handle,
      },
    });

    return NextResponse.json({ connection: serializeSocialConnection(connection) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync social connection." },
      { status: 400 },
    );
  }
}
