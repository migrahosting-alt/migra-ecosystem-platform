import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeContentJob } from "@/lib/migramarket-social";
import { publishSocialJobForOrg } from "@/lib/migramarket-social-publisher";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/jobs/[id]/publish");
  if (!access.ok) return access.response;

  const { id } = await params;

  try {
    const result = await publishSocialJobForOrg(access.context.activeOrg.orgId, id);

    await writeAuditLog({
      actorId: access.context.session.user.id,
      actorRole: access.context.activeOrg.role,
      orgId: access.context.activeOrg.orgId,
      action: "MIGRAMARKET_CONTENT_JOB_PUBLISHED",
      resourceType: "migramarket_content_job",
      resourceId: result.job.id,
      ip: access.context.ip,
      userAgent: access.context.userAgent,
      metadata: {
        platform: result.job.platform,
        connectionId: result.job.connectionId,
        publishedVia: result.publishedVia,
        platformPostId: result.platformPostId,
        externalPostUrl: result.externalPostUrl,
      },
    });

    return NextResponse.json({
      job: serializeContentJob(result.job),
      publishedVia: result.publishedVia,
      platformPostId: result.platformPostId,
      externalPostUrl: result.externalPostUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to publish content job." },
      { status: 400 },
    );
  }
}
