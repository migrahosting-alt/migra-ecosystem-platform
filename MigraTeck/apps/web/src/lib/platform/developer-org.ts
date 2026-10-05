import type { AppSession } from "@migrateck/auth-client";
import { fetchAuthApi } from "@/lib/auth/api";

export type LiveOrganization = {
  id: string;
  name: string;
  slug: string;
  role: string;
  joined_at: string;
};

export async function resolveDeveloperOrganization(
  session: AppSession,
): Promise<LiveOrganization | null> {
  const result = await fetchAuthApi<{ organizations: LiveOrganization[] }>("/v1/organizations");
  if (!result.ok) return null;

  if (session.activeOrgId) {
    const active = result.data.organizations.find((org) => org.id === session.activeOrgId);
    if (active) return active;
  }

  const parentOrg = result.data.organizations.find((org) => org.slug === "migrateck");
  if (parentOrg) return parentOrg;

  if (result.data.organizations.length === 1) {
    return result.data.organizations[0] ?? null;
  }

  return null;
}
