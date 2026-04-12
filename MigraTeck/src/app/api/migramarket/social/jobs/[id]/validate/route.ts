import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { validateSocialJobForOrg } from "@/lib/migramarket-campaign-governance";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeContentJob } from "@/lib/migramarket-social";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/jobs/[id]/validate");
  if (!access.ok) return access.response;

  const { id } = await params;

  try {
    const result = await validateSocialJobForOrg(access.context.activeOrg.orgId, id);

    await writeAuditLog({
      actorId: access.context.session.user.id,
      actorRole: access.context.activeOrg.role,
      orgId: access.context.activeOrg.orgId,
      action: "MIGRAMARKET_CONTENT_JOB_VALIDATED",
      resourceType: "migramarket_content_job",
      resourceId: result.job.id,
      ip: access.context.ip,
      userAgent: access.context.userAgent,
      metadata: {
        validationId: result.validation.id,
        finalStatus: result.report.final_status,
        reasons: result.report.reasons,
      },
    });

    return NextResponse.json({
      job: serializeContentJob(result.job),
      report: result.report,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to validate content job." },
      { status: 400 },
    );
  }
}
