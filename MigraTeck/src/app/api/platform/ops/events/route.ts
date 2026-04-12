import { MembershipStatus, ProvisioningJobStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { getFilteredAuditEvents, OpsAccessError, resolveOpsScope, toApiEventRow } from "@/lib/ops/observability";
import { assertRateLimit } from "@/lib/security/rate-limit";

const querySchema = z.object({
  orgId: z.string().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  riskTier: z.enum(["0", "1", "2"]).optional(),
  route: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  include: z.enum(["none", "webhooks", "provisioning", "all"]).default("none"),
  provisioningStatus: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "DEAD", "CANCELED"]).optional(),
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
    actorId: request.nextUrl.searchParams.get("actorId") || undefined,
    action: request.nextUrl.searchParams.get("action") || undefined,
    riskTier: request.nextUrl.searchParams.get("riskTier") || undefined,
    route: request.nextUrl.searchParams.get("route") || undefined,
    from: request.nextUrl.searchParams.get("from") || undefined,
    to: request.nextUrl.searchParams.get("to") || undefined,
    limit: request.nextUrl.searchParams.get("limit") || undefined,
    include: request.nextUrl.searchParams.get("include") || "none",
    provisioningStatus: request.nextUrl.searchParams.get("provisioningStatus") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query." }, { status: 400 });
  }

  let scope;
  try {
    scope = await resolveOpsScope({
      actorUserId,
      requestedOrgId: parsed.data.orgId,
      route: "/api/platform/ops/events",
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
    action: "ops:events:read",
    maxAttempts: 240,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const filtered = await getFilteredAuditEvents(scope.orgId, {
    actorId: parsed.data.actorId,
    action: parsed.data.action,
    riskTier: parsed.data.riskTier !== undefined ? Number(parsed.data.riskTier) as 0 | 1 | 2 : undefined,
    route: parsed.data.route,
    from: parsed.data.from ? new Date(parsed.data.from) : undefined,
    to: parsed.data.to ? new Date(parsed.data.to) : undefined,
    limit: parsed.data.limit,
  });

  const includeWebhooks = parsed.data.include === "all" || parsed.data.include === "webhooks";
  const includeProvisioning = parsed.data.include === "all" || parsed.data.include === "provisioning";

  const [webhooks, provisioningRuns] = await Promise.all([
    includeWebhooks
      ? prisma.billingWebhookEvent.findMany({
          orderBy: { receivedAt: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
    includeProvisioning
      ? prisma.provisioningJob.findMany({
          where: {
            orgId: scope.orgId,
            ...(parsed.data.provisioningStatus ? { status: parsed.data.provisioningStatus as ProvisioningJobStatus } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const actorMemberships = filtered.events.length
    ? await prisma.membership.findMany({
        where: {
          orgId: scope.orgId,
          status: MembershipStatus.ACTIVE,
          userId: {
            in: filtered.events.map((event) => event.userId).filter((value): value is string => Boolean(value)),
          },
        },
        select: {
          userId: true,
          role: true,
        },
      })
    : [];

  const roleByUserId = new Map(actorMemberships.map((item) => [item.userId, item.role]));

  return NextResponse.json({
    scope: {
      orgId: scope.orgId,
      role: scope.role,
      platformOwner: scope.platformOwner,
    },
    events: filtered.events.map((event) => ({
      ...toApiEventRow(event),
      actorRole: event.userId ? (roleByUserId.get(event.userId) || null) : null,
    })),
    totals: filtered.totals,
    drilldown: {
      webhooks,
      provisioningRuns,
    },
  });
}
