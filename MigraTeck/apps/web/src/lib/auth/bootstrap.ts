import { getAuthClientConfig, type BootstrapFn } from "@migrateck/auth-client";
import { derivePlatformPermissions } from "./permissions";

type OrganizationResponse = {
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    joined_at: string;
  }>;
};

async function fetchOrganizations(accessToken: string) {
  const cfg = getAuthClientConfig();
  const response = await fetch(`${cfg.migraAuthBaseUrl}/v1/organizations`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch organizations");
  }

  return response.json() as Promise<OrganizationResponse>;
}

export const bootstrapPlatformUser: BootstrapFn = async ({
  accessToken,
  refreshToken,
  expiresInSeconds,
}) => {
  const memberships = await fetchOrganizations(accessToken);
  const primaryOrg = memberships.organizations[0] ?? null;

  return {
    activeOrg: primaryOrg
      ? {
          id: primaryOrg.id,
          name: primaryOrg.name,
          role: primaryOrg.role,
        }
      : null,
    permissions: primaryOrg ? derivePlatformPermissions(primaryOrg.role) : [],
    productAccount: {
      onboardingStep: primaryOrg ? "complete" : "initial",
      organizations: memberships.organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: organization.role,
        joinedAt: organization.joined_at,
      })),
      _tokens: {
        accessToken,
        refreshToken: refreshToken ?? null,
        expiresAt: Date.now() + expiresInSeconds * 1000,
      },
    },
  };
};
