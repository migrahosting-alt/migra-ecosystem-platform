import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsDashboardPayload } from "@/lib/vps/data";
import { VpsActionBar, VpsOverviewHero, VpsServerCommandDeck, VpsServerControlBanner, VpsServerTabs } from "@/components/app/vps-ui";

export default async function VpsServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    notFound();
  }

  const payload = await getVpsDashboardPayload(serverId, membership);

  if (!payload) {
    notFound();
  }

  const diagnostics = payload.diagnostics;

  return (
    <section className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink-muted)]">
        <Link href="/app" className="font-semibold hover:text-[var(--ink)]">App</Link>
        <span>/</span>
        <Link href="/app/vps" className="font-semibold hover:text-[var(--ink)]">VPS</Link>
        <span>/</span>
        <span className="font-semibold text-[var(--ink)]">{payload.server.name}</span>
      </div>

      <VpsOverviewHero payload={payload} />
      <VpsServerCommandDeck payload={payload} />
      <VpsActionBar
        serverId={payload.server.id}
        serverName={payload.server.name}
        providerSlug={payload.server.providerSlug}
        currentImageSlug={payload.server.imageSlug}
        currentOsName={payload.server.osName}
        actions={payload.actions}
        features={payload.features}
        powerState={payload.server.powerState}
      />
      <VpsServerTabs serverId={payload.server.id} features={payload.features} />

      {!diagnostics.server.lastSyncedAt ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This server has never been synced against its provider binding. Run a sync before treating the overview as authoritative.
        </div>
      ) : null}

      {payload.sync.isStale ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          VPS data is stale. Last sync was {diagnostics.server.lastSyncedAt ? new Date(diagnostics.server.lastSyncedAt).toLocaleString() : "never"} and the provider should be refreshed before treating this state as authoritative.
        </div>
      ) : null}

      {diagnostics.incident ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          Incident {diagnostics.incident.id} is {diagnostics.incident.state.toLowerCase()} with {diagnostics.alerts.openCount} open alerts{diagnostics.sla ? ` and SLA state ${diagnostics.sla.state.toLowerCase()}` : ""}.
        </div>
      ) : null}

      {payload.server.status === "RESCUED" ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          This server is currently in rescue mode. Normal workload assumptions are suspended until rescue is disabled and the node returns to the standard runtime state.
        </div>
      ) : null}

      {payload.sync.pendingActionCount > 0 ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {payload.sync.pendingActionCount} VPS action {payload.sync.pendingActionCount === 1 ? "is" : "are"} still in progress. Overview, activity, and sync surfaces will update as jobs finish.
        </div>
      ) : null}

      <VpsServerControlBanner payload={payload} />

      {!payload.features.console || !payload.features.firewall || !payload.features.snapshots || !payload.features.backups || !payload.features.monitoring ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[color:var(--surface)/0.45] px-4 py-3 text-sm text-[var(--ink-muted)]">
          Some capabilities are currently disabled for this environment or provider binding. The workspace remains available for diagnostics, while unsupported write actions stay blocked until the capability is enabled.
        </div>
      ) : null}

      {children}
    </section>
  );
}
