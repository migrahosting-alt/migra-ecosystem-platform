import { OrgRole, ProvisioningJobStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { appendProvisioningJobEvent } from "@/lib/provisioning/jobs";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { OpsAccessError, resolveOpsScope } from "@/lib/ops/observability";
import { requireSameOrigin } from "@/lib/security/csrf";
import { MutationIntentError } from "@/lib/security/intent";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";

const bodySchema = z.object({
  intentId: z.string().cuid(),
  reason: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const { id } = await context.params;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const job = await prisma.provisioningJob.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      status: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let scope;
  try {
    scope = await resolveOpsScope({
      actorUserId,
      requestedOrgId: job.orgId,
      route: "/api/platform/ops/jobs/[id]/cancel",
      ip,
      userAgent,
    });
  } catch (error) {
    if (error instanceof OpsAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${scope.orgId}:${ip}`,
    action: "ops:jobs:cancel",
    maxAttempts: 120,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const payload = {
    jobId: job.id,
    operation: "cancel",
    reason: parsed.data.reason || null,
  };

  try {
    await assertMutationSecurity({
      actorUserId,
      actorRole: scope.role as OrgRole,
      orgId: job.orgId,
      action: "ops:job:cancel",
      riskTier: 2,
      ip,
      userAgent,
      route: "/api/platform/ops/jobs/[id]/cancel",
      intentId: parsed.data.intentId,
      payload,
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError || error instanceof MutationIntentError) {
      return NextResponse.json({ error: "Forbidden" }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(job.status === ProvisioningJobStatus.PENDING || job.status === ProvisioningJobStatus.RUNNING)) {
    return NextResponse.json({ error: "Job cannot be canceled." }, { status: 409 });
  }

  const updated = await prisma.provisioningJob.update({
    where: { id: job.id },
    data: {
      status: ProvisioningJobStatus.CANCELED,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: parsed.data.reason || "canceled_by_operator",
      lastErrorAt: new Date(),
    },
  });

  await appendProvisioningJobEvent({
    jobId: job.id,
    status: ProvisioningJobStatus.CANCELED,
    message: "manual_cancel",
    metadata: {
      actorUserId,
      reason: parsed.data.reason || null,
    },
  });

  await writeAuditLog({
    actorId: actorUserId,
    actorRole: scope.role,
    orgId: job.orgId,
    action: "PROVISIONING_JOB_CANCELED",
    resourceType: "provisioning_job",
    resourceId: job.id,
    ip,
    userAgent,
    riskTier: 2,
    metadata: {
      previousStatus: job.status,
      reason: parsed.data.reason || null,
    },
  });

  return NextResponse.json({ job: updated });
}
