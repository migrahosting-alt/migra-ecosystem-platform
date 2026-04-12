import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getClientIp, getUserAgent } from "@/lib/request";
import { getSloMetrics, getWorkerDashboard, OpsAccessError, resolveOpsScope } from "@/lib/ops/observability";
import { assertRateLimit } from "@/lib/security/rate-limit";

const querySchema = z.object({
  orgId: z.string().optional(),
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
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query." }, { status: 400 });
  }

  let scope;
  try {
    scope = await resolveOpsScope({
      actorUserId,
      requestedOrgId: parsed.data.orgId,
      route: "/api/platform/ops/health",
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
    action: "ops:health:read",
    maxAttempts: 600,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const [sloMetrics, workerDashboard] = await Promise.all([
    getSloMetrics(scope.orgId),
    getWorkerDashboard(scope.orgId),
  ]);

  return NextResponse.json({
    scope,
    slos: sloMetrics,
    workers: {
      queueDepth: workerDashboard.queue.pending + workerDashboard.queue.processing,
      oldestQueueAgeSeconds: workerDashboard.queue.oldestAgeSeconds,
      highRetryCount: workerDashboard.queue.highRetry,
      deadLetterCount: workerDashboard.queue.deadLetterCount,
      alerts: workerDashboard.alerts,
      lastSuccess: {
        provisioning: workerDashboard.workers.provisioning.lastSuccessAt,
        entitlementExpiry: workerDashboard.workers.entitlementExpiry.lastSuccessAt,
        socialConnectionSync: workerDashboard.workers.socialConnectionSync.lastSuccessAt,
      },
      socialConnections: workerDashboard.socialConnections,
    },
    generatedAt: new Date().toISOString(),
  });
}
