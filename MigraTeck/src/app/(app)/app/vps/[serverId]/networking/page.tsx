import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsDashboardPayload } from "@/lib/vps/data";
import { VpsDetailGrid, VpsSectionCard, VpsWorkspaceModuleGrid, VpsWorkspaceSectionHeader } from "@/components/app/vps-ui";

export default async function VpsNetworkingPage({ params }: { params: Promise<{ serverId: string }> }) {
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

  return (
    <div className="space-y-6">
      <VpsWorkspaceSectionHeader
        eyebrow="Networking"
        title="Address plane and access posture"
        description="Public ingress, private addressing, SSH exposure, and reverse-DNS state for this compute node."
        meta={payload.server.publicIpv4}
      />

      <VpsWorkspaceModuleGrid
        modules={[
          {
            title: "Public edge",
            status: payload.server.publicIpv4 ? "ACTIVE" : "PENDING",
            description: `This server presents public traffic on ${payload.server.publicIpv4} and remains reachable through the operator edge path for SSH and workload ingress.`,
            detail: payload.server.gatewayIpv4 || "Provider-managed gateway",
          },
          {
            title: "Private network",
            status: payload.server.privateIpv4 ? "ACTIVE" : "PENDING",
            description: payload.server.privateIpv4
              ? `Private address ${payload.server.privateIpv4} is attached for east-west or provider-side network coordination.`
              : "No private interface is currently attached to this server.",
            detail: payload.server.privateNetwork || "No private network assigned",
          },
          {
            title: "SSH access",
            status: "ACTIVE",
            description: `Primary operator access is exposed via ${payload.server.sshEndpoint} using the default account ${payload.server.defaultUsername}.`,
            detail: `Port ${payload.server.sshPort}`,
          },
          {
            title: "DNS identity",
            status: payload.server.reverseDns ? "ACTIVE" : "ATTENTION",
            description: payload.server.reverseDns
              ? `Reverse-DNS is mapped to ${payload.server.reverseDns} with provider status ${payload.server.reverseDnsStatus || "reported"}.`
              : "Reverse-DNS is not configured yet, which leaves mail-sensitive or audit-sensitive workloads with a weaker network identity.",
            detail: payload.server.reverseDnsStatus || "Pending",
          },
        ]}
      />

      <VpsSectionCard title="IP configuration" description="Public, private, and reverse-DNS state.">
        <VpsDetailGrid
          items={[
            { label: "Public IPv4", value: payload.server.publicIpv4 },
            { label: "Private IPv4", value: payload.server.privateIpv4 || "Not attached" },
            { label: "Gateway", value: payload.server.gatewayIpv4 || "Provider managed" },
            { label: "Private network", value: payload.server.privateNetwork || "None" },
            { label: "Reverse DNS", value: payload.server.reverseDns || "Not set" },
            { label: "rDNS status", value: payload.server.reverseDnsStatus || "Pending" },
          ]}
        />
      </VpsSectionCard>

      <VpsSectionCard title="SSH access" description="Connection endpoint and access-hardening settings.">
        <VpsDetailGrid
          items={[
            { label: "SSH endpoint", value: payload.server.sshEndpoint },
            { label: "SSH port", value: String(payload.server.sshPort) },
            { label: "Default username", value: payload.server.defaultUsername },
            { label: "Firewall profile", value: payload.server.firewallProfileName || "Not assigned" },
          ]}
        />
      </VpsSectionCard>
    </div>
  );
}
