export type PortalBootstrapInput = {
  authUserId: string;
  email: string;
  displayName?: string;
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
};

export type PortalBootstrapResult = {
  portalUserId: string;
  tenantId: string;
  customerId: string;
  membershipId: string;
  permissions: string[];
};

export const PORTAL_BOOTSTRAP_REQUIREMENTS = [
  "Create or link local user",
  "Create or link tenant",
  "Create or link membership",
  "Create or link customer",
  "Return portal-scoped permissions",
] as const;
