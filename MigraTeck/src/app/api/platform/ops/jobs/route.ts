import { ProvisioningJobStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { OpsAccessError, resolveOpsScope } from "@/lib/ops/observability";
import { assertRateLimit } from "@/lib/security/rate-limit";

const querySchema = z.object({
  orgId: z.string().optional(),
  status: z.nativeEnum(ProvisioningJobStatus).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const parsed = querySchema.safeParse({
    orgId: request.nextUrl.searchParams.get("orgId") || undefined,
    status: request.nextUrl.searchParams.get("status") || undefined,
    limit: request.nextUrl.searchParams.get("limit") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query." }, { status: 400 });
  }

  let scope;
  try {
    scope = await resolveOpsScope({
      actorUserId,
      requestedOrgId: parsed.data.orgId,
      route: "/api/platform/ops/jobs",
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
    action: "ops:jobs:read",
    maxAttempts: 240,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const jobs = await prisma.provisioningJob.findMany({
    where: {
      orgId: scope.orgId,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    },
    include: {
      events: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit || 100,
  });

  return NextResponse.json({
    scope,
    jobs,
  });
}
