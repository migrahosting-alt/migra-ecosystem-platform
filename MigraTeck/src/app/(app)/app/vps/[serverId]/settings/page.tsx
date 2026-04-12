import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsCapabilities } from "@/lib/vps/access";
import { resolveActorRole } from "@/lib/vps/authz";
import { getVpsDashboardPayload } from "@/lib/vps/data";
import { listSupportedVpsImages } from "@/lib/vps/images";
import { VpsDetailGrid, VpsSectionCard } from "@/components/app/vps-ui";

export default async function VpsSettingsPage({ params }: { params: Promise<{ serverId: string }> }) {
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

  const resolvedRole = await resolveActorRole({
    userId: session.user.id,
    orgId: membership.orgId,
    role: membership.role,
  }, serverId);
  const capabilities = getVpsCapabilities(resolvedRole.role);
  const supportedImages = listSupportedVpsImages(payload.server.providerSlug);

  return (
    <div className="space-y-6">
      <VpsSectionCard title="Server metadata" description="Naming, tagging, and operator defaults for this VPS.">
        <VpsDetailGrid
          items={[
            { label: "Server name", value: payload.server.name },
            { label: "Hostname", value: payload.server.hostname },
            { label: "Instance ID", value: payload.server.instanceId },
            { label: "Default username", value: payload.server.defaultUsername },
          ]}
        />
      </VpsSectionCard>

      <VpsSectionCard title="Access and control posture" description="Current role-derived controls for this VPS workspace.">
        <VpsDetailGrid
          items={[
            { label: "Manage settings", value: capabilities.canManageSettings ? "Yes" : "No" },
            { label: "Power control", value: payload.actions.canPowerControl ? "Yes" : "No" },
            { label: "Sync", value: payload.actions.canSync ? "Yes" : "No" },
            { label: "Rescue mode", value: payload.actions.canRescue ? "Yes" : "No" },
            { label: "Rebuild", value: payload.actions.canRebuild ? "Yes" : "No" },
            { label: "Console", value: payload.actions.canOpenConsole ? "Yes" : "No" },
            { label: "Firewall", value: payload.actions.canManageFirewall ? "Yes" : "No" },
            { label: "Snapshots", value: payload.actions.canManageSnapshots ? "Yes" : "No" },
            { label: "Backups", value: payload.actions.canManageBackups ? "Yes" : "No" },
          ]}
        />
      </VpsSectionCard>

      <VpsSectionCard title="Provider binding" description="Actual provider identity and sync state for this VPS.">
        <VpsDetailGrid
          items={[
            { label: "Provider slug", value: payload.server.providerSlug },
            { label: "Provider server ID", value: payload.server.providerServerId || "Not bound" },
            { label: "Provider plan ID", value: payload.server.providerPlanId || "Not recorded" },
            { label: "Provider region ID", value: payload.server.providerRegionId || "Not recorded" },
            { label: "Virtualization", value: payload.server.virtualizationType || "Provider managed" },
            { label: "Private network", value: payload.server.privateNetwork || "Not attached" },
            { label: "Gateway IPv4", value: payload.server.gatewayIpv4 || "Not recorded" },
            { label: "Provider health", value: payload.server.providerHealthState },
            { label: "Provider error", value: payload.server.providerError || "None" },
            { label: "Drift", value: payload.server.driftType || "None detected" },
            { label: "Last sync", value: payload.server.lastSyncedAt ? new Date(payload.server.lastSyncedAt).toLocaleString() : "Never" },
          ]}
        />
      </VpsSectionCard>

      <VpsSectionCard title="Operating system images" description="Supported reinstall targets for this VPS provider and portal workflow.">
        <VpsDetailGrid
          items={[
            { label: "Current image", value: `${payload.server.osName} (${payload.server.imageSlug})` },
            { label: "Image version", value: payload.server.imageVersion || "Provider default" },
            { label: "Rebuild allowed", value: payload.actions.canRebuild ? "Yes" : "No" },
            { label: "Available images", value: String(supportedImages.length) },
          ]}
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {supportedImages.map((image) => (
            <div key={image.slug} className={`rounded-xl border px-4 py-3 ${image.slug === payload.server.imageSlug ? "border-emerald-300 bg-emerald-50" : "border-[var(--line)] bg-[var(--surface-2)]"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-[var(--ink)]">{image.name}</p>
                {image.highlighted ? (
                  <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                    Ready
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{image.description}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                {image.family} · Login: {image.defaultUsername} · Slug: {image.slug}
              </p>
            </div>
          ))}
        </div>
      </VpsSectionCard>
    </div>
  );
}
