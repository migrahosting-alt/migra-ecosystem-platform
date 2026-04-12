import { OrgRole } from "@prisma/client";
import { VpsFleetActionsClient } from "@/components/app/vps-fleet-actions-client";
import { VpsFleetInventoryClient } from "@/components/app/vps-fleet-inventory-client";
import {
  VpsCloudControlBar,
  VpsEmptyState,
  VpsFleetAttentionBanner,
  VpsGlobalStatusStrip,
  VpsIncidentSummaryCard,
  VpsOperationsPanel,
  VpsOperationalEmptyState,
  VpsPlatformPosture,
  VpsProviderFabricPanel,
} from "@/components/app/vps-ui";
import { requireAuthSession, getActiveOrgContext } from "@/lib/auth/session";
import { buildMigraHostingRequestAccessHref } from "@/lib/migrahosting-pricing";
import { roleAtLeast } from "@/lib/rbac";
import { getVpsFleetWorkspace } from "@/lib/vps/data";

export default async function VpsFleetPage() {
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    return (
      <VpsEmptyState
        title="No organization context"
        description="Create or join an organization before opening the VPS workspace."
      />
    );
  }

  const fleet = await getVpsFleetWorkspace(membership);

  if (fleet.workspaceState === "NOT_ENABLED") {
    return (
      <VpsEmptyState
        title="VPS workspace not enabled"
        description="This organization does not currently have VPS hosting access enabled. Once a MigraHosting server is attached, the VPS workspace will become available here."
      />
    );
  }

  const canManageFleet = roleAtLeast(membership.role, OrgRole.ADMIN);
  const deployHref = buildMigraHostingRequestAccessHref();

  return (
    <div className="min-h-screen bg-[#fafbfd]">
      <section className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
        <VpsCloudControlBar fleet={fleet}>
          <VpsFleetActionsClient
            canManage={canManageFleet}
            canImportFromProviders={fleet.canImportFromProviders}
            deployHref={deployHref}
            providers={fleet.providers}
          />
        </VpsCloudControlBar>

        <div className="mt-4">
          <VpsGlobalStatusStrip fleet={fleet} />
        </div>

        {fleet.banner ? (
          <div className="mt-4">
            <VpsFleetAttentionBanner
              banner={fleet.banner}
              {...(fleet.sync.lastSyncedAt ? { lastSyncedAt: fleet.sync.lastSyncedAt } : {})}
            />
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-12 gap-5 xl:items-start xl:gap-6">
          <main className="col-span-12 xl:col-span-8">
            {fleet.servers.length ? (
              <section id="vps-fleet-inventory" className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)]">
                <VpsFleetInventoryClient servers={fleet.servers} />
              </section>
            ) : (
              <section id="vps-fleet-inventory">
                <VpsOperationalEmptyState
                  providers={fleet.providers}
                  canImportFromProviders={fleet.canImportFromProviders}
                  deployHref={deployHref}
                />
              </section>
            )}
          </main>

          <aside className="col-span-12 xl:col-span-4">
            <VpsProviderFabricPanel providers={fleet.providers} />
          </aside>
        </div>

        <div className="mt-6 grid grid-cols-12 gap-5 xl:gap-6">
          <div className="col-span-12 xl:col-span-8">
            <VpsOperationsPanel fleet={fleet} />
          </div>
          <div className="col-span-12 xl:col-span-4">
            <VpsIncidentSummaryCard fleet={fleet} />
          </div>
        </div>

        <div className="mt-6 pb-10">
          <VpsPlatformPosture fleet={fleet} />
        </div>
      </section>
    </div>
  );
}
