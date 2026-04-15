import { requirePermission } from "@migrateck/auth-client";
import { fetchAuthApi } from "@/lib/auth/api";
import { OrganizationsWorkspace } from "@/components/platform/OrganizationsWorkspace";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { getPlatformOrganizations } from "@/lib/platform";
import { getCommercialSnapshot, hasProductAccess } from "@/lib/platform/commercial";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  const organizations = getPlatformOrganizations(session);
  const activeOrgName = session.activeOrgName ?? "No active organization";
  const activeOrgId = session.activeOrgId ?? null;

  const organizationStats = Object.fromEntries(
    await Promise.all(
      organizations.map(async (organization) => {
        const [membersResult, commercial] = await Promise.all([
          fetchAuthApi<{ members: Array<{ id: string }> }>(`/v1/organizations/${encodeURIComponent(organization.id)}/members`),
          getCommercialSnapshot(organization.id),
        ]);

        const enabledProducts = ["builder", "hosting", "intake"].filter((family) => (
          hasProductAccess(commercial.entitlements, family as "builder" | "hosting" | "intake")
        )).length;

        return [organization.id, {
          memberCount: membersResult.ok ? membersResult.data.members.length : 0,
          enabledProducts,
          billingStatus: commercial.account?.status ?? "unconfigured",
          currentPlan: commercial.subscriptions[0]?.planCode ?? null,
        }];
      }),
    ),
  );

  const activeOrgStats = activeOrgId ? organizationStats[activeOrgId] : null;
  const commercialBoundary = activeOrgStats?.currentPlan
    ?? (activeOrgStats?.billingStatus === "unconfigured" ? "Setup pending" : activeOrgStats?.billingStatus ?? "Pending");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Organization management"
        title="Organizations"
        description="Organizations are the operating containers for members, billing, permissions, and product access across MigraTeck."
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <PlatformStatCard
          label="Active organization"
          value={activeOrgName}
          detail="This context controls the billing, team, and product state used across the platform."
        />
        <PlatformStatCard
          label="Accessible orgs"
          value={String(organizations.length)}
          detail={organizations.length > 1 ? "You can switch workspaces without leaving the platform." : "Additional organizations will appear here as they are created or assigned."}
        />
        <PlatformStatCard
          label="Commercial boundary"
          value={commercialBoundary}
          detail={activeOrgStats
            ? `${activeOrgStats.memberCount} member${activeOrgStats.memberCount === 1 ? "" : "s"}, ${activeOrgStats.enabledProducts} enabled product${activeOrgStats.enabledProducts === 1 ? "" : "s"}.`
            : "Role resolution comes from MigraAuth and drives platform access decisions."}
        />
      </div>

      <OrganizationsWorkspace
        initialOrganizations={organizations}
        organizationStats={organizationStats}
        {...(session.activeOrgId ? { activeOrgId: session.activeOrgId } : {})}
      />
    </div>
  );
}
