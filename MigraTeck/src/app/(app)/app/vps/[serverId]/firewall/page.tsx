import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsFirewallState } from "@/lib/vps/data";
import { VpsFirewallEditor } from "@/components/app/vps-firewall-editor";
import { VpsDetailGrid, VpsSectionCard, VpsStatusBadge } from "@/components/app/vps-ui";

export default async function VpsFirewallPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    notFound();
  }

  const firewall = await getVpsFirewallState(serverId, membership.orgId);

  if (!firewall) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <VpsSectionCard title="Firewall control plane" description="Canonical firewall policy, provider capabilities, and rollback-aware apply flow.">
        <VpsDetailGrid
          items={[
            { label: "Firewall enabled", value: firewall.enabled ? "Enabled" : "Disabled" },
            { label: "Profile", value: firewall.profileName },
            { label: "Default inbound", value: firewall.defaults.inbound },
            { label: "Default outbound", value: firewall.defaults.outbound },
            { label: "Provider", value: firewall.providerSlug },
            { label: "Provider write", value: firewall.capabilities.firewallWrite ? "Enabled" : "Read only" },
            { label: "Last applied", value: firewall.lastAppliedAt ? new Date(firewall.lastAppliedAt).toLocaleString() : "Not applied yet" },
            { label: "Rule count", value: String(firewall.ruleCount) },
          ]}
        />
        <div className="mt-4 flex items-center gap-3">
          <VpsStatusBadge status={firewall.status} />
          <span className="text-sm text-[var(--ink-muted)]">Anti-lockout {firewall.antiLockoutSatisfied ? "satisfied" : "needs review"}</span>
        </div>
      </VpsSectionCard>

      <VpsFirewallEditor serverId={serverId} initialFirewall={firewall} />
    </div>
  );
}
