import { getAuthClientConfig, type BootstrapFn } from "@migrateck/auth-client";
import {
  deriveAuthorityPermissions,
  derivePlatformPermissions,
  mergePermissions,
} from "./permissions";

type OrganizationResponse = {
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    joined_at: string;
  }>;
};

type PlatformAuthorityResponse = {
  user_id: string;
  email: string;
  roles: string[];
  permissions: string[];
  via_bootstrap: boolean;
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

async function fetchPlatformAuthority(accessToken: string): Promise<PlatformAuthorityResponse | null> {
  const cfg = getAuthClientConfig();
  const response = await fetch(`${cfg.migraAuthBaseUrl}/v1/admin/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  // Most normal customer identities are not platform principals. MigraAuth
  // deliberately returns 404 for this protected admin surface when the caller
  // has no platform authority, so 404 is an expected "not a platform
  // principal" result too. Operator enrichment must never break ordinary login.
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    console.warn("MigraAuth platform-authority enrichment unavailable", {
      status: response.status,
    });
    return null;
  }

  return response.json() as Promise<PlatformAuthorityResponse>;
}

export const bootstrapPlatformUser: BootstrapFn = async ({
  accessToken,
  refreshToken,
  expiresInSeconds,
}) => {
  const [memberships, platformAuthority] = await Promise.all([
    fetchOrganizations(accessToken),
    fetchPlatformAuthority(accessToken),
  ]);

  const primaryOrg = memberships.organizations[0] ?? null;
  const organizationPermissions = primaryOrg
    ? derivePlatformPermissions(primaryOrg.role)
    : [];
  const authorityPermissions = platformAuthority
    ? deriveAuthorityPermissions(platformAuthority.roles)
    : [];
  const permissions = mergePermissions(organizationPermissions, authorityPermissions);

  return {
    activeOrg: primaryOrg
      ? {
          id: primaryOrg.id,
          name: primaryOrg.name,
          role: primaryOrg.role,
        }
      : null,
    permissions,
    productAccount: {
      onboardingStep:
        primaryOrg || platformAuthority
          ? "complete"
          : "initial",
      organizations: memberships.organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: organization.role,
        joinedAt: organization.joined_at,
      })),
      platformAuthority: platformAuthority
        ? {
            roles: platformAuthority.roles,
            permissions: platformAuthority.permissions,
            viaBootstrap: platformAuthority.via_bootstrap,
          }
        : null,
      _tokens: {
        accessToken,
        refreshToken: refreshToken ?? null,
        expiresAt: Date.now() + expiresInSeconds * 1000,
      },
    },
  };
};
