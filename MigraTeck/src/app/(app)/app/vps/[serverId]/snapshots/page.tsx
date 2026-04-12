import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsDashboardPayload, listVpsSnapshots } from "@/lib/vps/data";
import { VpsSectionCard } from "@/components/app/vps-ui";
import { VpsSnapshotManager } from "@/components/app/vps-snapshot-manager";

export default async function VpsSnapshotsPage({ params }: { params: Promise<{ serverId: string }> }) {
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

  if (!payload.features.snapshots) {
    return (
      <VpsSectionCard title="Snapshots unavailable" description="This provider binding does not expose managed snapshots through the VPS portal.">
        <p className="text-sm text-[var(--ink-muted)]">
          Snapshot controls are intentionally disabled for {payload.server.providerSlug}. The portal keeps the rest of the VPS workspace available, but snapshot creation, restore, and deletion remain blocked until the provider exposes a supported contract.
        </p>
      </VpsSectionCard>
    );
  }

  const snapshots = await listVpsSnapshots(serverId, membership.orgId);

  if (!snapshots) {
    notFound();
  }

  return (
    <VpsSnapshotManager
      serverId={serverId}
      canManageSnapshots={payload.actions.canManageSnapshots}
      initialSnapshots={snapshots.map((snapshot) => ({
        ...snapshot,
        createdAt: snapshot.createdAt.toISOString(),
      }))}
    />
  );
}
