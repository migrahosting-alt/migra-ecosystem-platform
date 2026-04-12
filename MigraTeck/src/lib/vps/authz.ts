import { type Membership, type Organization } from "@prisma/client";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { writeVpsAuditEvent } from "@/lib/vps/audit";
import { resolveServerScopedRole, roleMeetsRequirement, type VpsRole } from "@/lib/vps/access";

export type ResolvedActorRole = {
  role: VpsRole;
  source: "SERVER" | "ORG";
};

type ActorIdentity = Pick<RequestActor, "userId" | "orgId" | "role" | "sourceIp">;

export type RequestActor = {
  userId: string;
  orgId: string;
  role: Membership["role"];
  sourceIp?: string | undefined;
  membership: Membership & { org: Organization };
};

function resolveSourceIp(request?: Request) {
  if (!request) {
    return undefined;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || undefined;
  }

  return request.headers.get("x-real-ip") || undefined;
}

export async function requireActor(request?: Request): Promise<RequestActor> {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    throw Object.assign(new Error("UNAUTHORIZED"), { response: authResult.response });
  }

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) {
    throw new Error("NO_ACTIVE_ORG");
  }

  return {
    userId: authResult.session.user.id,
    orgId: membership.orgId,
    role: membership.role,
    sourceIp: resolveSourceIp(request),
    membership,
  };
}

export async function resolveActorRole(actor: Pick<RequestActor, "userId" | "orgId" | "role">, serverId: string): Promise<ResolvedActorRole> {
  const membership = await prisma.vpsServerMember.findFirst({
    where: {
      serverId,
      userId: actor.userId,
      server: {
        orgId: actor.orgId,
      },
    },
    select: {
      role: true,
    },
  });

  return {
    role: resolveServerScopedRole(actor.role, membership?.role),
    source: membership ? "SERVER" : "ORG",
  };
}

export class VpsAccessDeniedError extends Error {
  httpStatus: number;
  code: string;

  constructor(message = "Forbidden") {
    super(message);
    this.name = "VpsAccessDeniedError";
    this.httpStatus = 403;
    this.code = "ACCESS_DENIED";
  }
}

export async function denyServerAccess(input: {
  actor: Pick<RequestActor, "userId" | "orgId">;
  serverId: string;
  sourceIp?: string | undefined;
  action: string;
  requiredRole: string;
  actualRole: string;
  reason?: string | undefined;
}) {
  await writeVpsAuditEvent({
    orgId: input.actor.orgId,
    serverId: input.serverId,
    actorUserId: input.actor.userId,
    sourceIp: input.sourceIp,
    eventType: "ACCESS_DENIED",
    severity: "WARNING",
    metadataJson: {
      action: input.action,
      requiredRole: input.requiredRole,
      actualRole: input.actualRole,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
}

export async function requireRole(input: {
  actor: ActorIdentity;
  serverId: string;
  allowed: VpsRole[];
  action: string;
  sourceIp?: string | undefined;
}) {
  const resolved = await resolveActorRole(input.actor, input.serverId);
  if (!roleMeetsRequirement(resolved.role, input.allowed)) {
    await denyServerAccess({
      actor: input.actor,
      serverId: input.serverId,
      sourceIp: input.sourceIp || input.actor.sourceIp,
      action: input.action,
      requiredRole: input.allowed.join("|"),
      actualRole: resolved.role,
    });
    throw new VpsAccessDeniedError();
  }

  return resolved;
}
