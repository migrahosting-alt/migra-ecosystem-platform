import { OrgRole } from "@prisma/client";

const roleRank: Record<OrgRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  BILLING: 3,
  MEMBER: 2,
  READONLY: 1,
};

export type PermissionAction =
  | "ops:read"
  | "audit:read"
  | "audit:export"
  | "org:manage"
  | "org:entitlement:view"
  | "org:entitlement:edit"
  | "org:invite:manage"
  | "billing:manage"
  | "product:launch"
  | "product:request-access"
  | "downloads:read"
  | "downloads:sign"
  | "membership:read"
  | "platform:config:manage"
  | "builder:read"
  | "builder:edit"
  | "builder:publish"
  | "builder:admin"
  // Phase F: Enterprise / Compliance
  | "secrets:read"
  | "secrets:manage"
  | "compliance:read"
  | "compliance:manage"
  | "backup:read"
  | "backup:manage"
  | "access-review:read"
  | "access-review:manage"
  | "incidents:read"
  | "incidents:manage";

const rolePermissions: Record<OrgRole, PermissionAction[]> = {
  OWNER: [
    "ops:read",
    "audit:read",
    "audit:export",
    "org:manage",
    "org:entitlement:view",
    "org:entitlement:edit",
    "org:invite:manage",
    "platform:config:manage",
    "billing:manage",
    "product:launch",
    "product:request-access",
    "downloads:read",
    "downloads:sign",
    "membership:read",
    "builder:read",
    "builder:edit",
    "builder:publish",
    "builder:admin",
    "secrets:read",
    "secrets:manage",
    "compliance:read",
    "compliance:manage",
    "backup:read",
    "backup:manage",
    "access-review:read",
    "access-review:manage",
    "incidents:read",
    "incidents:manage",
  ],
  ADMIN: [
    "ops:read",
    "audit:read",
    "audit:export",
    "org:manage",
    "org:entitlement:view",
    "org:entitlement:edit",
    "org:invite:manage",
    "billing:manage",
    "product:launch",
    "product:request-access",
    "downloads:read",
    "downloads:sign",
    "membership:read",
    "builder:read",
    "builder:edit",
    "builder:publish",
    "builder:admin",
    "secrets:read",
    "secrets:manage",
    "compliance:read",
    "compliance:manage",
    "backup:read",
    "backup:manage",
    "access-review:read",
    "access-review:manage",
    "incidents:read",
    "incidents:manage",
  ],
  BILLING: [
    "audit:read",
    "org:entitlement:view",
    "billing:manage",
    "product:launch",
    "product:request-access",
    "downloads:read",
    "downloads:sign",
    "membership:read",
    "compliance:read",
    "backup:read",
    "incidents:read",
  ],
  MEMBER: ["org:entitlement:view", "product:launch", "product:request-access", "downloads:read", "downloads:sign", "membership:read", "builder:read", "builder:edit", "compliance:read", "incidents:read"],
  READONLY: ["audit:read", "org:entitlement:view", "product:request-access", "downloads:read", "membership:read", "builder:read", "compliance:read"],
};

export function roleAtLeast(currentRole: OrgRole, minimumRole: OrgRole): boolean {
  return roleRank[currentRole] >= roleRank[minimumRole];
}

export function can(role: OrgRole, action: PermissionAction): boolean {
  return rolePermissions[role].includes(action);
}

export function canViewAudit(role: OrgRole): boolean {
  return can(role, "audit:read");
}

export function canManageOrg(role: OrgRole): boolean {
  return can(role, "org:manage");
}

export function canManageBilling(role: OrgRole): boolean {
  return can(role, "billing:manage");
}

export function canEditEntitlements(role: OrgRole): boolean {
  return can(role, "org:entitlement:edit");
}
