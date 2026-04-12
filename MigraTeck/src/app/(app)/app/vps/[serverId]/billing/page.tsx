import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsCapabilities } from "@/lib/vps/access";
import { resolveActorRole } from "@/lib/vps/authz";
import { getVpsBillingState } from "@/lib/vps/data";
import { VpsDetailGrid, VpsSectionCard, VpsWorkspaceModuleGrid, VpsWorkspaceSectionHeader } from "@/components/app/vps-ui";

export default async function VpsBillingPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    notFound();
  }

  const billing = await getVpsBillingState(serverId, membership.orgId);

  if (!billing) {
    notFound();
  }

  const resolvedRole = await resolveActorRole({
    userId: session.user.id,
    orgId: membership.orgId,
    role: membership.role,
  }, serverId);
  const capabilities = getVpsCapabilities(resolvedRole.role);
  if (!capabilities.canViewBilling) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <VpsWorkspaceSectionHeader
        eyebrow="Billing"
        title="Commercial posture"
        description="Plan footprint, recurring charge visibility, renewal timing, and commercial escalation paths for this server."
        meta={billing.planName || billing.planSlug}
      />

      <VpsWorkspaceModuleGrid
        modules={[
          {
            title: "Plan contract",
            status: "ACTIVE",
            description: `${billing.planName || billing.planSlug} is provisioned with ${billing.vcpu} vCPU, ${Math.round(billing.memoryMb / 1024)} GB RAM, ${billing.diskGb} GB storage, and ${billing.bandwidthTb} TB bandwidth.`,
            detail: billing.billingCycle,
          },
          {
            title: "Recurring charge",
            status: "ACTIVE",
            description: `Visible recurring cost is ${new Intl.NumberFormat("en-US", { style: "currency", currency: billing.billingCurrency, maximumFractionDigits: 0 }).format(billing.monthlyPriceCents / 100)} per month equivalent.`,
            detail: billing.billingCurrency,
          },
          {
            title: "Renewal cadence",
            status: billing.renewalAt || billing.nextInvoiceAt ? "ACTIVE" : "ATTENTION",
            description: billing.renewalAt || billing.nextInvoiceAt
              ? `Renewal and invoice timing are present in the portal for commercial review and client alignment.`
              : "Renewal or invoice timing is not fully represented in the current billing payload.",
            detail: billing.renewalAt ? new Date(billing.renewalAt).toLocaleDateString() : "Not scheduled",
          },
          {
            title: "Billing support",
            status: billing.supportTicketUrl || billing.supportDocsUrl ? "ACTIVE" : "READY",
            description: billing.supportTicketUrl || billing.supportDocsUrl
              ? "Server-linked commercial routes are attached for support and billing follow-up."
              : "Commercial support falls back to the standard MigraHosting billing workflow when no server-specific links are attached.",
            detail: billing.supportTier || "STANDARD",
          },
        ]}
      />

      <VpsSectionCard title="Current billing summary" description="Plan, renewal, invoice timing, and support-linked add-ons.">
        <VpsDetailGrid
          items={[
            { label: "Plan", value: billing.planName || billing.planSlug },
            { label: "Resources", value: `${billing.vcpu} vCPU / ${Math.round(billing.memoryMb / 1024)} GB / ${billing.diskGb} GB / ${billing.bandwidthTb} TB` },
            { label: "Monthly price", value: new Intl.NumberFormat("en-US", { style: "currency", currency: billing.billingCurrency, maximumFractionDigits: 0 }).format(billing.monthlyPriceCents / 100) + "/mo" },
            { label: "Billing cycle", value: billing.billingCycle },
            { label: "Renewal date", value: billing.renewalAt ? new Date(billing.renewalAt).toLocaleDateString() : "Not scheduled" },
            { label: "Next invoice", value: billing.nextInvoiceAt ? new Date(billing.nextInvoiceAt).toLocaleDateString() : "Not scheduled" },
            { label: "Support tier", value: billing.supportTier || "STANDARD" },
            { label: "Last sync", value: billing.lastSyncedAt ? new Date(billing.lastSyncedAt).toLocaleString() : "Never" },
          ]}
        />
      </VpsSectionCard>

      <VpsSectionCard title="Billing operations" description="Commercial links and access state for this server.">
        <VpsDetailGrid
          items={[
            { label: "Can manage billing", value: capabilities.canManageBilling ? "Yes" : "No" },
            { label: "Provider health", value: billing.providerHealthState },
            { label: "Drift", value: billing.driftType || "None detected" },
            { label: "Support tier", value: billing.supportTier || "STANDARD" },
            { label: "Invoice cadence", value: billing.billingCycle === "YEARLY" ? "Annual" : "Monthly" },
            { label: "Catalog plan key", value: billing.planSlug },
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-3">
          {billing.supportTicketUrl ? (
            <Link
              href={billing.supportTicketUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
            >
              Open Billing Ticket
            </Link>
          ) : null}
          {billing.supportDocsUrl ? (
            <Link
              href={billing.supportDocsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
            >
              Billing Documentation
            </Link>
          ) : null}
          {!billing.supportTicketUrl && !billing.supportDocsUrl ? (
            <p className="text-sm text-[var(--ink-muted)]">Commercial support for this server is handled through the standard MigraHosting billing workflow when no server-specific links are attached.</p>
          ) : null}
        </div>
      </VpsSectionCard>
    </div>
  );
}
