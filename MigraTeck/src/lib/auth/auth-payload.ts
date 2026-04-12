import { type OrgRole } from "@prisma/client";

export function mapAuthPayload(input: {
  user: {
    id: string;
    email: string | null;
    name?: string | null;
  };
  organization: {
    id: string;
    slug: string;
    name: string;
  };
  membership: {
    role: OrgRole;
  };
  tenant?: {
    id: string;
    status: string;
    planCode: string;
    storageQuotaGb: number;
  } | null;
  accessToken?: string;
}) {
  return {
    user: {
      id: input.user.id,
      email: input.user.email,
      fullName: input.user.name ?? null,
    },
    organization: input.organization,
    membership: {
      role: input.membership.role,
    },
    tenant: input.tenant
      ? {
          tenantId: input.tenant.id,
          status: input.tenant.status,
          planCode: input.tenant.planCode,
          storageQuotaGb: input.tenant.storageQuotaGb,
        }
      : null,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  };
}