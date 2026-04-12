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
    <section className="mx-auto max-w-[1280px] space-y-4">
      <VpsCloudControlBar fleet={fleet}>
        <VpsFleetActionsClient
          canManage={canManageFleet}
          canImportFromProviders={fleet.canImportFromProviders}
          deployHref={deployHref}
          providers={fleet.providers}
        />
      </VpsCloudControlBar>

      {fleet.banner ? <VpsFleetAttentionBanner banner={fleet.banner} lastSyncedAt={fleet.sync.lastSyncedAt} /> : null}

      <VpsGlobalStatusStrip fleet={fleet} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_360px]">
        <div className="space-y-4">
          {fleet.servers.length ? (
            <section id="vps-fleet-inventory" className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-[1.4rem] border border-[var(--line)] bg-white px-5 py-4 shadow-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Compute inventory</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-[var(--ink)]">Fleet Inventory</h2>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">Servers first: status, provider authority, drift posture, alerts, and operator access.</p>
                </div>
                <p className="text-sm font-semibold text-[var(--ink-muted)]">{fleet.summary.running} running / {fleet.summary.total} total</p>
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

          <VpsOperationsPanel fleet={fleet} />
        </div>

        <VpsFleetOpsSidebar fleet={fleet} />
      </div>

      <VpsPlatformPosture fleet={fleet} />
    </section>
  );
}
