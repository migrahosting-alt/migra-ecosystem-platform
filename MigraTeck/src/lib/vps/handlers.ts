import { NextRequest, NextResponse } from "next/server";
import type { RebuildInput } from "@/lib/vps/providers";
import type { VpsActionType } from "@prisma/client";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { getControlPlaneRestriction, type VpsRole } from "@/lib/vps/access";
import { executeVpsAction, openVpsConsoleSession, syncVpsServer, type VpsActionName } from "@/lib/vps/actions";
import { denyServerAccess, requireActor, requireRole, VpsAccessDeniedError, type RequestActor } from "@/lib/vps/authz";
import { writeVpsAuditEvent } from "@/lib/vps/audit";
import { assertProviderActionSupport } from "@/lib/vps/provider-support";
import { forbidden, notFound, ok, serverError, unauthorized } from "@/lib/vps/http";
import { createActionJob } from "@/lib/vps/jobs";
import { getPrimaryProviderBinding, getServerForActor } from "@/lib/vps/queries";
import { getProvider } from "@/lib/vps/providers";

type RateLimitConfig = {
  action: string;
  maxAttempts: number;
  windowSeconds: number;
};

type PreparedServerMutationRequest = {
  actor: RequestActor;
  serverId: string;
  ip: string;
  userAgent?: string | undefined;
};

export async function prepareServerMutationRequest(input: {
  request: NextRequest;
  params: Promise<{ serverId: string }>;
  rateLimit: RateLimitConfig;
}): Promise<PreparedServerMutationRequest | Response> {
  const csrfFailure = requireSameOrigin(input.request);
  if (csrfFailure) {
    return csrfFailure;
  }

  let actor: RequestActor;
  try {
    actor = await requireActor(input.request);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED" && "response" in error) {
      return (error as Error & { response: Response }).response;
    }

    if (error instanceof Error && error.message === "NO_ACTIVE_ORG") {
      return NextResponse.json({ error: "No active organization context." }, { status: 404 });
    }

    return NextResponse.json({ error: "Request authorization failed." }, { status: 500 });
  }

  const ip = getClientIp(input.request);
  const { serverId } = await input.params;
  const limiter = await assertRateLimit({
    key: `${actor.userId}:${actor.orgId}:${serverId}:${ip}`,
    action: input.rateLimit.action,
    maxAttempts: input.rateLimit.maxAttempts,
    windowSeconds: input.rateLimit.windowSeconds,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  return {
    actor,
    serverId,
    ip,
    userAgent: getUserAgent(input.request),
  };
}

export function legacyActionErrorResponse(error: unknown, fallbackMessage: string) {
  const status = error instanceof Error && "httpStatus" in error && typeof (error as { httpStatus?: unknown }).httpStatus === "number"
    ? (error as { httpStatus: number }).httpStatus
    : 500;

  return NextResponse.json({ error: error instanceof Error ? error.message : fallbackMessage }, { status });
}

export async function handleLegacyServerActionRequest(input: {
  request: NextRequest;
  params: Promise<{ serverId: string }>;
  rateLimit: RateLimitConfig;
  action: VpsActionName;
  errorMessage: string;
  requestPayload?: Record<string, unknown> | undefined;
  rebuildInput?: RebuildInput | undefined;
}) {
  const prepared = await prepareServerMutationRequest({
    request: input.request,
    params: input.params,
    rateLimit: input.rateLimit,
  });
  if (prepared instanceof Response) {
    return prepared;
  }

  try {
    const result = await executeVpsAction({
      membership: prepared.actor.membership,
      serverId: prepared.serverId,
      action: input.action,
      actorUserId: prepared.actor.userId,
      actorRole: prepared.actor.role,
      ip: prepared.ip,
      userAgent: prepared.userAgent,
      requestPayload: input.requestPayload,
      rebuildInput: input.rebuildInput,
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return legacyActionErrorResponse(error, input.errorMessage);
  }
}

export async function handleLegacyServerSyncRequest(input: {
  request: NextRequest;
  params: Promise<{ serverId: string }>;
  rateLimit: RateLimitConfig;
  errorMessage: string;
}) {
  const prepared = await prepareServerMutationRequest({
    request: input.request,
    params: input.params,
    rateLimit: input.rateLimit,
  });
  if (prepared instanceof Response) {
    return prepared;
  }

  try {
    const result = await syncVpsServer({
      membership: prepared.actor.membership,
      serverId: prepared.serverId,
      actorUserId: prepared.actor.userId,
      actorRole: prepared.actor.role,
      ip: prepared.ip,
      userAgent: prepared.userAgent,
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return legacyActionErrorResponse(error, input.errorMessage);
  }
}

export async function handleLegacyConsoleSessionRequest(input: {
  request: NextRequest;
  params: Promise<{ serverId: string }>;
  rateLimit: RateLimitConfig;
  errorMessage: string;
}) {
  const prepared = await prepareServerMutationRequest({
    request: input.request,
    params: input.params,
    rateLimit: input.rateLimit,
  });
  if (prepared instanceof Response) {
    return prepared;
  }

  try {
    const session = await openVpsConsoleSession({
      membership: prepared.actor.membership,
      serverId: prepared.serverId,
      actorUserId: prepared.actor.userId,
      actorRole: prepared.actor.role,
      ip: prepared.ip,
      userAgent: prepared.userAgent,
    });

    return NextResponse.json({ session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return legacyActionErrorResponse(error, input.errorMessage);
  }
}

export async function handleServerAction(params: {
  request?: Request | undefined;
  actor?: RequestActor | undefined;
  serverId: string;
  rateLimit?: RateLimitConfig | undefined;
  actionType: VpsActionType;
  allowedRoles: VpsRole[];
  eventType: string;
  severity?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | undefined;
  requestJson?: unknown | undefined;
}) {
  try {
    let actor = params.actor;
    let sourceIp = actor?.sourceIp;

    if (!actor && params.request && params.rateLimit) {
      const prepared = await prepareServerMutationRequest({
        request: params.request as NextRequest,
        params: Promise.resolve({ serverId: params.serverId }),
        rateLimit: params.rateLimit,
      });

      if (prepared instanceof Response) {
        return prepared;
      }

      actor = prepared.actor;
      sourceIp = prepared.ip;
    }

    actor = actor || await requireActor(params.request);

    const server = await getServerForActor(params.serverId, actor.orgId);
    if (!server) {
      return notFound("Server not found");
    }

    const resolvedRole = await requireRole({
      actor,
      serverId: server.id,
      allowed: params.allowedRoles,
      action: params.actionType,
      sourceIp: sourceIp || actor.sourceIp,
    });
    const restriction = getControlPlaneRestriction({
      providerHealthState: server.providerHealthState,
      action: params.actionType,
    });

    if (restriction.blocked) {
      await denyServerAccess({
        actor,
        serverId: server.id,
        sourceIp: sourceIp || actor.sourceIp,
        action: params.actionType,
        requiredRole: "PROVIDER_HEALTHY",
        actualRole: resolvedRole.role,
        reason: restriction.reason,
      });

      return NextResponse.json({ error: restriction.reason }, { status: 403 });
    }

    const binding = getPrimaryProviderBinding(server);
    if (!binding) {
      return notFound("Missing provider binding.");
    }

    const provider = getProvider(binding.providerSlug);
    assertProviderActionSupport({
      providerSlug: binding.providerSlug,
      capabilities: provider.capabilities,
      action: params.actionType,
    });

    const job = await createActionJob({
      serverId: server.id,
      orgId: actor.orgId,
      action: params.actionType,
      requestedByUserId: actor.userId,
      requestJson: params.requestJson,
    });

    await writeVpsAuditEvent({
      orgId: actor.orgId,
      serverId: server.id,
      actorUserId: actor.userId,
      sourceIp: sourceIp || actor.sourceIp,
      eventType: params.eventType,
      severity: params.severity || "INFO",
      relatedJobId: job.id,
      metadataJson: params.requestJson,
    });

    return ok({
      jobId: job.id,
      status: job.status,
      message: "queued_for_background_execution",
      result: {
        status: job.status,
        message: "queued_for_background_execution",
      },
    });
  } catch (error) {
    if (error instanceof VpsAccessDeniedError) {
      return forbidden();
    }

    if (error instanceof Error && error.message === "NO_ACTIVE_ORG") {
      return notFound("No active organization context.");
    }

    if (
      error instanceof Error &&
      "httpStatus" in error &&
      typeof (error as { httpStatus?: unknown }).httpStatus === "number"
    ) {
      return NextResponse.json(
        {
          error: {
            code: (error as Error & { code?: string }).code || "PROVIDER_CAPABILITY_UNSUPPORTED",
            message: error.message,
          },
        },
        { status: (error as Error & { httpStatus: number }).httpStatus },
      );
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED" && "response" in error) {
      return unauthorized();
    }

    return serverError("Failed to execute VPS action", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
