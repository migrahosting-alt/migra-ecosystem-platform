import Link from "next/link";
import { notFound } from "next/navigation";
import { VpsDetailGrid } from "@/components/app/vps-ui";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsDashboardPayload } from "@/lib/vps/data";

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

  const cards = [
    {
      label: "Public edge",
      value: payload.server.publicIpv4,
      helper: payload.server.gatewayIpv4 || "Provider-managed gateway",
      tone: "success",
    },
    {
      label: "Private plane",
      value: payload.server.privateIpv4 || "Not attached",
      helper: payload.server.privateNetwork || "No private network assigned",
      tone: payload.server.privateIpv4 ? "success" : "neutral",
    },
    {
      label: "SSH access",
      value: payload.server.sshEndpoint,
      helper: `Default account ${payload.server.defaultUsername}`,
      tone: "success",
    },
    {
      label: "DNS identity",
      value: payload.server.reverseDns || "Not configured",
      helper: payload.server.reverseDnsStatus || "Pending provider confirmation",
      tone: payload.server.reverseDns ? "success" : "warning",
    },
  ] as const;

  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    neutral: "border-slate-200 bg-slate-100 text-slate-700",
  } as const;

  return (
    <div className="space-y-4 pb-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">{card.value}</p>
              </div>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass[card.tone]}`}>
                {card.tone}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">{card.helper}</p>
          </article>
        ))}
      </section>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)] xl:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Network plane</p>
              <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Address And Access Fabric</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Public ingress, east-west addressing, SSH reachability, and DNS identity for this server’s operator and workload paths.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/app/vps/${payload.server.id}/console`} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Open console
              </Link>
              <Link href={`/app/vps/${payload.server.id}/firewall`} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Firewall
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Ingress path</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">Public endpoint {payload.server.publicIpv4}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Traffic reaches this node through the public edge with gateway {payload.server.gatewayIpv4 || "managed by the provider"}. Use firewall policy before widening access paths.
              </p>
            </article>
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Internal segmentation</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{payload.server.privateIpv4 || "No private interface"}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {payload.server.privateIpv4
                  ? `Private network ${payload.server.privateNetwork || "assigned"} is available for east-west routing and internal service topology.`
                  : "No provider-side private network is attached, so all operational entry still depends on the public edge and firewall posture."}
              </p>
            </article>
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Operator access</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{payload.server.sshEndpoint}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                SSH remains the primary operator path with default account {payload.server.defaultUsername} on port {payload.server.sshPort}. Console access is available as a fallback through the control plane.
              </p>
            </article>
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Name resolution</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{payload.server.reverseDns || "Reverse DNS not set"}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {payload.server.reverseDns
                  ? `Reverse-DNS is mapped with provider status ${payload.server.reverseDnsStatus || "reported"}, which improves auditability and mail-sensitive workload identity.`
                  : "Reverse-DNS is still unset, leaving this server with a weaker outward network identity for audited or mail-sensitive traffic."}
              </p>
            </article>
          </div>
        </section>

        <aside className="col-span-12 space-y-4 xl:col-span-4">
          <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Access posture</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Operator Guidance</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-4 w-4 rounded-full border border-slate-300 bg-slate-50 text-center text-[10px] leading-[14px] text-slate-500">✓</span>
                <p>{payload.server.firewallEnabled ? "Firewall policy is present. Review explicit access rules before onboarding more services." : "Apply a firewall profile before widening public ingress to this node."}</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-4 w-4 rounded-full border border-slate-300 bg-slate-50 text-center text-[10px] leading-[14px] text-slate-500">✓</span>
                <p>{payload.server.reverseDns ? "DNS identity is configured. Keep hostname alignment consistent with support and audit records." : "Configure reverse DNS if this server fronts email-sensitive or compliance-sensitive workloads."}</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-4 w-4 rounded-full border border-slate-300 bg-slate-50 text-center text-[10px] leading-[14px] text-slate-500">✓</span>
                <p>{payload.server.privateIpv4 ? "Use the private interface for east-west traffic where possible instead of public loops." : "No internal network path is attached, so treat the public interface as the primary risk surface."}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Quick facts</p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Firewall</span>
                <span className="font-semibold text-slate-950">{payload.server.firewallEnabled ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Private network</span>
                <span className="font-semibold text-slate-950">{payload.server.privateNetwork || "None"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">SSH port</span>
                <span className="font-semibold text-slate-950">{payload.server.sshPort}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-6">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Address inventory</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">IP Configuration</h2>
          </div>
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
        </section>

        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-6">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Access inventory</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Operator Access</h2>
          </div>
          <VpsDetailGrid
            items={[
              { label: "SSH endpoint", value: payload.server.sshEndpoint },
              { label: "SSH port", value: String(payload.server.sshPort) },
              { label: "Default username", value: payload.server.defaultUsername },
              { label: "Firewall profile", value: payload.server.firewallProfileName || "Not assigned" },
              { label: "Region", value: payload.server.region },
              { label: "Datacenter", value: payload.server.datacenterLabel || payload.server.region },
            ]}
          />
        </section>
      </div>
    </div>
  );
}
