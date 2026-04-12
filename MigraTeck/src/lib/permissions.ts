import type { OrgRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type PermissionAction } from "@/lib/rbac";

/**
 * Fine-grained permission engine.
 *
 * Layered resolution order:
 * 1. Check explicit grant/deny in Permission table (most specific wins)
 * 2. Fall back to coarse RBAC role from membership
 *
 * This allows RBAC to serve as a baseline while individual overrides
 * (grants or denials) can be applied per user, per org, per resource.
 */

interface PermissionCheck {
  userId: string;
  orgId: string;
  role: OrgRole;
  action: PermissionAction | string;
  resource?: string | undefined;
  resourceId?: string | undefined;
}

interface PermissionResult {
  allowed: boolean;
  source: "explicit_grant" | "explicit_deny" | "role_grant" | "role_deny";
}

export async function checkPermission(input: PermissionCheck): Promise<PermissionResult> {
  // 1. Check explicit permission (most specific: with resourceId)
  if (input.resource && input.resourceId) {
    const specific = await prisma.permission.findUnique({
      where: {
        orgId_userId_action_resource_resourceId: {
          orgId: input.orgId,
          userId: input.userId,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
        },
      },
      select: { granted: true, expiresAt: true },
    });

    if (specific && (!specific.expiresAt || specific.expiresAt > new Date())) {
      return {
        allowed: specific.granted,
        source: specific.granted ? "explicit_grant" : "explicit_deny",
      };
    }
  }

  // 2. Check resource-level permission (without resourceId)
  if (input.resource) {
    const resourceLevel = await prisma.permission.findFirst({
      where: {
        orgId: input.orgId,
        userId: input.userId,
        action: input.action,
        resource: input.resource,
        resourceId: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { granted: true },
    });

    if (resourceLevel) {
      return {
        allowed: resourceLevel.granted,
        source: resourceLevel.granted ? "explicit_grant" : "explicit_deny",
      };
    }
  }

  // 3. Check action-level permission (no resource context)
  const actionLevel = await prisma.permission.findFirst({
    where: {
      orgId: input.orgId,
      userId: input.userId,
      action: input.action,
      resource: null,
      resourceId: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: { granted: true },
  });

  if (actionLevel) {
    return {
      allowed: actionLevel.granted,
      source: actionLevel.granted ? "explicit_grant" : "explicit_deny",
    };
  }

  // 4. Fall back to coarse RBAC
  const isPermissionAction = isKnownPermissionAction(input.action);
  if (isPermissionAction) {
    const allowed = can(input.role, input.action as PermissionAction);
    return {
      allowed,
      source: allowed ? "role_grant" : "role_deny",
    };
  }

  // Unknown action with no explicit grant → deny
  return { allowed: false, source: "role_deny" };
}

function isKnownPermissionAction(action: string): action is PermissionAction {
  const known: string[] = [
    "ops:read", "audit:read", "audit:export",
    "org:manage", "org:entitlement:view", "org:entitlement:edit", "org:invite:manage",
    "billing:manage",
    "product:launch", "product:request-access",
    "downloads:read", "downloads:sign",
    "membership:read",
    "platform:config:manage",
    "builder:read", "builder:edit", "builder:publish", "builder:admin",
  ];
  return known.includes(action);
}

// ── Management helpers ──

export async function grantPermission(input: {
  orgId: string;
  userId: string;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
  grantedBy: string;
  expiresAt?: Date | null;
}) {
  return prisma.permission.upsert({
    where: {
      orgId_userId_action_resource_resourceId: {
        orgId: input.orgId,
        userId: input.userId,
        action: input.action,
        resource: (input.resource ?? null) as string,
        resourceId: (input.resourceId ?? null) as string,
      },
    },
    update: {
      granted: true,
      grantedBy: input.grantedBy,
      expiresAt: input.expiresAt ?? null,
    },
    create: {
      orgId: input.orgId,
      userId: input.userId,
      action: input.action,
      resource: input.resource ?? null,
      resourceId: input.resourceId ?? null,
      granted: true,
      grantedBy: input.grantedBy,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function denyPermission(input: {
  orgId: string;
  userId: string;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
  grantedBy: string;
  expiresAt?: Date | null;
}) {
  return prisma.permission.upsert({
    where: {
      orgId_userId_action_resource_resourceId: {
        orgId: input.orgId,
        userId: input.userId,
        action: input.action,
        resource: (input.resource ?? null) as string,
        resourceId: (input.resourceId ?? null) as string,
      },
    },
    update: {
      granted: false,
      grantedBy: input.grantedBy,
      expiresAt: input.expiresAt ?? null,
    },
    create: {
      orgId: input.orgId,
      userId: input.userId,
      action: input.action,
      resource: input.resource ?? null,
      resourceId: input.resourceId ?? null,
      granted: false,
      grantedBy: input.grantedBy,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function revokePermission(input: {
  orgId: string;
  userId: string;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
}) {
  await prisma.permission.deleteMany({
    where: {
      orgId: input.orgId,
      userId: input.userId,
      action: input.action,
      resource: input.resource ?? null,
      resourceId: input.resourceId ?? null,
    },
  });
}

export async function listUserPermissions(userId: string, orgId: string) {
  return prisma.permission.findMany({
    where: {
      userId,
      orgId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: {
      action: true,
      resource: true,
      resourceId: true,
      granted: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { action: "asc" },
  });
}
