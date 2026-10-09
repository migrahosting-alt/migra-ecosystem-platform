import { requirePermission } from "@migrateck/auth-client";
import Link from "next/link";
import { PlatformEmptyState } from "@/components/platform/PlatformEmptyState";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import {
  getCommercialSnapshot,
  getCurrentCommercialPlan,
  getNumericEntitlement,
  hasProductAccess,
} from "@/lib/platform/commercial";

export const dynamic = "force-dynamic";

export default async function BuilderSitesPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const commercial = await getCommercialSnapshot(session.activeOrgId);
  const currentPlan = getCurrentCommercialPlan(commercial.subscriptions);
  const builderEnabled = hasProductAccess(commercial.entitlements, "builder");
  const siteCap = getNumericEntitlement(commercial.entitlements, "builder.sites.max");
  const aiCap = getNumericEntitlement(commercial.entitlements, "builder.ai_generations.monthly");
  const storageMb = getNumericEntitlement(commercial.entitlements, "builder.storage_mb");
  const seatCap = getNumericEntitlement(commercial.entitlements, "builder.team_seats.max");
  const builderUsage = commercial.usageSummary.filter((entry) => entry.productFamily === "builder");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Product entrypoint"
        title="Builder"
        description="Builder is the web publishing product entrypoint for the active organization. Commercial access, generation capacity, and deployment readiness are visible here even before the builder service backend is attached."
        actions={
          <>
            <Link
              href="/platform/billing"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Review Builder billing
            </Link>
            <Link
              href="/platform/hosting"
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Prepare deployment path
            </Link>
          </>
        }
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <PlatformStatCard
          label="Workspace context"
          value={session.activeOrgName ?? "Not selected"}
          detail="Builder launches from the same organization context used across billing, members, and security."
        />
        <PlatformStatCard
          label="Commercial plan"
          value={currentPlan?.planCode ?? "Not enabled"}
          detail={builderEnabled ? "Builder access is commercially enabled for this org." : "Builder access is not yet included in the active commercial state."}
        />
        <PlatformStatCard
          label="Site capacity"
          value={siteCap === -1 ? "Unlimited" : String(siteCap ?? 0)}
          detail={`AI generations: ${aiCap ?? 0} monthly. Team seats: ${seatCap ?? 0}.`}
        />
      </div>

      {!builderEnabled ? (
        <PlatformEmptyState
          title="Builder is not enabled for this organization"
          description="Activate a Builder-capable commercial plan before this org can create and publish sites from the control plane."
          actionLabel="Open billing"
          actionHref="/platform/billing"
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Operational status</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Sites inventory</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">The builder domain backend is not yet connected, so no site records are available in this control plane today.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Generation capacity</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">Commercial entitlements currently allow {aiCap ?? 0} AI generations per month and {storageMb ?? 0} MB of builder storage.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Publish path</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">Builder publishing should land on a Hosting-backed deployment path. Commercial readiness is visible even before the runtime is attached.</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Next operational steps</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-500">
            <p>1. Confirm the org has a Builder-capable plan and a deployment path.</p>
            <p>2. Attach the builder service backend so sites, pages, versions, and deployments become available here.</p>
            <p>3. Move the create-site and editor workflows into this shell once the backend exists.</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/platform/billing"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Review plan and entitlements
            </Link>
            <Link
              href="/platform/hosting"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Prepare deployment operations
            </Link>
          </div>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Current builder usage signal</h2>
        {builderUsage.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No builder usage events have been recorded yet.</p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {builderUsage.map((entry) => (
              <div key={`${entry.productFamily}:${entry.meterName}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{entry.meterName}</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{entry.totalQuantity}</p>
                <p className="mt-1 text-sm text-slate-500">Across {entry.eventCount} recorded event{entry.eventCount === 1 ? "" : "s"}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
