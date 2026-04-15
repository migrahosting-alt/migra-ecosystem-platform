import type { AppSession } from "@migrateck/auth-client";

export type PlatformOrganization = {
  id: string;
  name: string;
  slug: string;
  role: string;
  joinedAt: string;
};

type ProductAccountWithOrganizations = {
  onboardingStep?: string | null;
  organizations?: PlatformOrganization[];
};

export function getPlatformOrganizations(session: AppSession): PlatformOrganization[] {
  const productAccount = session.productAccount as ProductAccountWithOrganizations | undefined;
  return Array.isArray(productAccount?.organizations) ? productAccount.organizations : [];
}

export function getActiveOrganizationSummary(session: AppSession) {
  return {
    id: session.activeOrgId ?? null,
    name: session.activeOrgName ?? null,
    role: session.activeOrgRole ?? null,
  };
}

export function resolveAuthApiUrl() {
  return (
    process.env.MIGRAAUTH_BASE_URL
    ?? process.env.AUTH_PUBLIC_URL
    ?? process.env.NEXT_PUBLIC_AUTH_URL
    ?? "http://localhost:4000"
  ).replace(/\/+$/, "");
}

export function resolveAuthWebUrl() {
  return (
    process.env.MIGRAAUTH_WEB_URL
    ?? process.env.AUTH_WEB_URL
    ?? process.env.NEXT_PUBLIC_AUTH_WEB_URL
    ?? "http://localhost:4100"
  ).replace(/\/+$/, "");
}
