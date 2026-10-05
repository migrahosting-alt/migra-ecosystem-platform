const ownerPermissions = [
  "platform.read",
  "platform.manage",
  "orgs.read",
  "orgs.manage",
  "billing.read",
  "billing.manage",
];

export function derivePlatformPermissions(role: string): string[] {
  switch (role.trim().toUpperCase()) {
    case "OWNER":
      return ownerPermissions;
    case "ADMIN":
      return ["platform.read", "platform.manage", "orgs.read", "orgs.manage", "billing.read"];
    case "BILLING_ADMIN":
      return ["platform.read", "orgs.read", "billing.read", "billing.manage"];
    case "MEMBER":
      return ["platform.read", "orgs.read"];
    default:
      return [];
  }
}

/**
 * Parent-company platform authority is independent from customer organization
 * membership. A canonical MigraAuth platform role may open the MigraTeck
 * operator surface even when the identity belongs to no customer org.
 *
 * Keep this mapping intentionally narrow: organization/billing permissions
 * remain organization-scoped unless the caller is the platform OWNER.
 */
export function deriveAuthorityPermissions(roles: readonly string[]): string[] {
  const normalized = new Set(roles.map((role) => role.trim().toUpperCase()));

  if (normalized.has("OWNER")) {
    return ownerPermissions;
  }

  if (normalized.has("OPERATOR")) {
    return ["platform.read", "platform.manage"];
  }

  if (normalized.has("SUPPORT")) {
    return ["platform.read"];
  }

  return [];
}

export function mergePermissions(...sets: readonly string[][]): string[] {
  return [...new Set(sets.flat())];
}
