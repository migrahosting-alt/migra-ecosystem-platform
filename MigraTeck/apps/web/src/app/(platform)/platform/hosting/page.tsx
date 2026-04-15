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

export default async function HostingPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const commercial = await getCommercialSnapshot(session.activeOrgId);
  const currentPlan = getCurrentCommercialPlan(commercial.subscriptions);
  const hostingEnabled = hasProductAccess(commercial.entitlements, "hosting");
  const workloadCap = getNumericEntitlement(commercial.entitlements, "hosting.vps.max");
  const bandwidthCap = getNumericEntitlement(commercial.entitlements, "hosting.bandwidth.monthly_gb");
  const storageCap = getNumericEntitlement(commercial.entitlements, "hosting.storage_gb");
  const hostingUsage = commercial.usageSummary.filter((entry) => entry.productFamily === "hosting");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Infrastructure entrypoint"
        title="Hosting"
        description="Hosting is the deployment and workload control entrypoint. Commercial capacity and runtime readiness are visible here even before workload inventory is attached to the platform."
        actions={
          <>
            <Link href="/platform/billing" className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">Review hosting billing</Link>
            <Link href="/platform/security" className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700">Review security posture</Link>
          </>
        }
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <PlatformStatCard label="Current plan" value={currentPlan?.planCode ?? "Not enabled"} detail={hostingEnabled ? "Hosting access is commercially enabled for the active org." : "Hosting is not enabled for the current org."} />
        <PlatformStatCard label="Workload capacity" value={workloadCap === -1 ? "Unlimited" : String(workloadCap ?? 0)} detail={`Bandwidth cap: ${bandwidthCap ?? 0} GB monthly. Storage cap: ${storageCap ?? 0} GB.`} />
        <PlatformStatCard label="Runtime status" value="Awaiting backend" detail="The hosting domain backend is not yet attached to this control plane, so workload inventory cannot be listed here yet." />
      </div>

      {!hostingEnabled ? (
        <PlatformEmptyState title="Hosting is not enabled for this organization" description="Upgrade the commercial plan before creating or attaching hosting workloads to this org." actionLabel="Open billing" actionHref="/platform/billing" />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Operational readiness</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-semibold text-slate-900">Workloads</h3><p className="mt-2 text-sm leading-6 text-slate-500">No workload inventory is attached yet because the hosting service backend is still separate from this control plane.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-semibold text-slate-900">Backups and SSL</h3><p className="mt-2 text-sm leading-6 text-slate-500">Commercial settings already expose the backup and SSL entitlement posture for the active org.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-semibold text-slate-900">Deployment path</h3><p className="mt-2 text-sm leading-6 text-slate-500">This entrypoint will become the workload list and deployment console once the hosting backend is attached.</p></div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Next actions</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-500">
            <p>1. Confirm hosting entitlements and commercial boundaries.</p>
            <p>2. Connect the hosting workload inventory to this shell.</p>
            <p>3. Expose create-server and deployment actions once runtime APIs are available.</p>
          </div>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Current hosting usage signal</h2>
        {hostingUsage.length === 0 ? <p className="mt-4 text-sm text-slate-500">No hosting usage events have been recorded yet.</p> : <div className="mt-4 grid gap-4 md:grid-cols-3">{hostingUsage.map((entry) => <div key={`${entry.productFamily}:${entry.meterName}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{entry.meterName}</p><p className="mt-2 text-lg font-semibold text-slate-900">{entry.totalQuantity}</p><p className="mt-1 text-sm text-slate-500">Across {entry.eventCount} recorded event{entry.eventCount === 1 ? "" : "s"}</p></div>)}</div>}
      </section>
    </div>
  );
}
