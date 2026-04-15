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

export default async function IntakePage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const commercial = await getCommercialSnapshot(session.activeOrgId);
  const currentPlan = getCurrentCommercialPlan(commercial.subscriptions);
  const intakeEnabled = hasProductAccess(commercial.entitlements, "intake");
  const formCap = getNumericEntitlement(commercial.entitlements, "intake.forms.max");
  const submissionsCap = getNumericEntitlement(commercial.entitlements, "intake.submissions.monthly");
  const storageCap = getNumericEntitlement(commercial.entitlements, "intake.storage_mb");
  const intakeUsage = commercial.usageSummary.filter((entry) => entry.productFamily === "intake");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Workflow entrypoint"
        title="Intake"
        description="Intake will become the lead capture, form, and submissions operating surface. Commercial readiness is already visible here from the shared billing and entitlement layer."
        actions={
          <>
            <Link href="/platform/billing" className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">Review intake billing</Link>
            <Link href="/platform/compliance" className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700">Review governance</Link>
          </>
        }
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <PlatformStatCard label="Current plan" value={currentPlan?.planCode ?? "Not enabled"} detail={intakeEnabled ? "Intake access is commercially enabled for this org." : "Intake is not enabled for the current org."} />
        <PlatformStatCard label="Operational capacity" value={formCap === -1 ? "Unlimited" : String(formCap ?? 0)} detail={`Submission cap: ${submissionsCap ?? 0} monthly. Storage cap: ${storageCap ?? 0} MB.`} />
        <PlatformStatCard label="Workflow runtime" value="Awaiting backend" detail="The intake workflow service is not yet attached, so forms and submissions cannot be listed here yet." />
      </div>

      {!intakeEnabled ? <PlatformEmptyState title="Intake is not enabled for this organization" description="Upgrade the commercial plan before attaching forms, workflows, and submissions to this org." actionLabel="Open billing" actionHref="/platform/billing" /> : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Operational readiness</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-semibold text-slate-900">Forms inventory</h3><p className="mt-2 text-sm leading-6 text-slate-500">No forms can be listed until the intake workflow backend is attached to this control plane.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-semibold text-slate-900">Automation posture</h3><p className="mt-2 text-sm leading-6 text-slate-500">Automation, storage, and submission caps are already visible through org entitlements.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-semibold text-slate-900">Governance path</h3><p className="mt-2 text-sm leading-6 text-slate-500">This entrypoint will become the form and submissions console once the intake runtime is connected.</p></div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Next actions</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-500">
            <p>1. Confirm intake entitlements and monthly submission limits.</p>
            <p>2. Attach the intake workflow backend to this shell.</p>
            <p>3. Expose create-form and submissions actions once runtime APIs are available.</p>
          </div>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Current intake usage signal</h2>
        {intakeUsage.length === 0 ? <p className="mt-4 text-sm text-slate-500">No intake usage events have been recorded yet.</p> : <div className="mt-4 grid gap-4 md:grid-cols-3">{intakeUsage.map((entry) => <div key={`${entry.productFamily}:${entry.meterName}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{entry.meterName}</p><p className="mt-2 text-lg font-semibold text-slate-900">{entry.totalQuantity}</p><p className="mt-1 text-sm text-slate-500">Across {entry.eventCount} recorded event{entry.eventCount === 1 ? "" : "s"}</p></div>)}</div>}
      </section>
    </div>
  );
}
