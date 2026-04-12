import { OrgRole } from "@prisma/client";
import { VpsFleetActionsClient } from "@/components/app/vps-fleet-actions-client";
import {
  VpsCloudControlBar,
  VpsEmptyState,
  VpsFleetAttentionBanner,
  VpsFleetOpsSidebar,
  VpsFleetTable,
  VpsGlobalStatusStrip,
  VpsOperationsPanel,
  VpsOperationalEmptyState,
  VpsPlatformPosture,
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
    <div className="min-h-screen bg-slate-50">
      <section className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-6">
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
            <VpsFleetAttentionBanner banner={fleet.banner} lastSyncedAt={fleet.sync.lastSyncedAt} />
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-12 gap-6">
          <main className="col-span-12 xl:col-span-8">
            {fleet.servers.length ? (
              <section id="vps-fleet-inventory" className="overflow-hidden rounded-3xl border border-[var(--line)] bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-[var(--line)] px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)]">Fleet inventory</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ink)]">Servers</h2>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">Live server inventory, provider association, sync posture, and quick operator actions.</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-[var(--ink)] outline-none placeholder:text-slate-400 focus:border-slate-400"
                      placeholder="Search servers, IPs, plans..."
                    />
                    <button className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:bg-slate-50">
                      Filters
                    </button>
                  </div>
                </div>
                <VpsFleetTable servers={fleet.servers} />
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
            <VpsFleetOpsSidebar fleet={fleet} />
          </aside>
        </div>

        <div className="mt-6">
          <VpsOperationsPanel fleet={fleet} />
        </div>

        <div className="mt-6">
          <VpsPlatformPosture fleet={fleet} />
        </div>
      </section>
    </div>
  );
}
