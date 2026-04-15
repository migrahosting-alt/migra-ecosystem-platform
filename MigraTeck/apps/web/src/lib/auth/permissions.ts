const ownerPermissions = [
  "platform.read",
  "platform.manage",
  "orgs.read",
  "orgs.manage",
  "billing.read",
  "billing.manage",
];

export function derivePlatformPermissions(role: string): string[] {
  switch (role) {
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
