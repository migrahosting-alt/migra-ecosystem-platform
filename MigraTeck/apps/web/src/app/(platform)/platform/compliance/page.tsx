import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ComplianceWorkspace } from "@/components/platform/ComplianceWorkspace";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export const dynamic = "force-dynamic";

const policyLinks = [
  { label: "Terms of Service", href: "/legal/terms" },
  { label: "Privacy Policy", href: "/legal/privacy" },
  { label: "Payment Policy", href: "/legal/payment" },
  { label: "Acceptable Use Policy", href: "/legal/acceptable-use" },
] as const;

export default async function CompliancePage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  const hasOrganization = !!session.activeOrgId;

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Governance and policy"
        title="Compliance"
        description="Review policy posture, organization governance, and audit trail for your account."
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <PlatformStatCard
          label="Policy stack"
          value="Centralized"
          detail="Terms, privacy, payment, and acceptable use are managed as shared MigraTeck legal documents."
        />
        <PlatformStatCard
          label="Org readiness"
          value={hasOrganization ? "Configured" : "Pending"}
          detail={hasOrganization ? "An active organization exists for governance." : "Create an organization before compliance workflows can be attached."}
        />
        <PlatformStatCard
          label="Access review"
          value={session.permissions.includes("orgs.manage") ? "Owner-visible" : "Limited"}
          detail="Owner-level access is required for governance and review workflows."
        />
      </div>

      <section className="mb-6 grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Evidence scope</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Identity, membership, and administrative changes are sourced from MigraAuth audit logs. This page is the live evidence surface for operator review, not a static policy document.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Operating posture</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Governance is currently anchored to the active organization and shared legal policy set. Dedicated incident and retention services are not exposed yet, so this surface stays explicit about the controls that are live today.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Review workflow</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Use audit evidence to validate access changes, then use the Security and Members workspaces to remediate operator risk. Policy links remain the canonical source for contract and privacy terms.
          </p>
        </div>
      </section>

      {/* Real audit log */}
      <div className="mb-6">
        <ComplianceWorkspace />
      </div>

      {/* Policy links */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Policy library</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {policyLinks.map((policy) => (
            <Link
              key={policy.href}
              href={policy.href}
              className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 transition hover:border-slate-300 hover:bg-white"
            >
              <h3 className="text-sm font-semibold text-slate-900">{policy.label}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                View the current canonical policy document.
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
