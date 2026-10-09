import { requirePermission } from "@migrateck/auth-client";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Gauge,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import { PlatformEmptyState } from "@/components/platform/PlatformEmptyState";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import {
  getCommercialSnapshot,
  getNumericEntitlement,
  hasProductAccess,
} from "@/lib/platform/commercial";
import { IntakeRuntimeWorkspace } from "./IntakeRuntimeWorkspace";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const commercial = await getCommercialSnapshot(session.activeOrgId);
  const intakeEnabled = hasProductAccess(commercial.entitlements, "intake");
  const formCap = getNumericEntitlement(
    commercial.entitlements,
    "intake.forms.max",
  );
  const submissionsCap = getNumericEntitlement(
    commercial.entitlements,
    "intake.submissions.monthly",
  );
  const storageCap = getNumericEntitlement(
    commercial.entitlements,
    "intake.storage_mb",
  );
  const intakeUsage = commercial.usageSummary.filter(
    (entry) => entry.productFamily === "intake",
  );

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Infrastructure / MigraIntake"
        title="Intake"
        description="Operate the current MigraIntake reality without mixing scopes: global legacy runtime visibility for MigraTeck operators, and separate organization-level commercial readiness for the future tenant-native service."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/platform/billing"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Review Intake billing
            </Link>
            <Link
              href="/platform/compliance"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Governance evidence <ArrowRight size={14} />
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Layers3 size={18} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">
            Legacy runtime
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            The existing production portal is global and file-backed. It is not
            silently assigned to the active customer organization.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Building2 size={18} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">
            Tenant-native target
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            The newer Intake service already models tenant IDs, but it remains a
            migration target until authentication and production persistence are
            ready.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={18} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">
            Read-only bridge
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            MigraTeck reads sanitized runtime metadata only. Submission answers,
            attachment paths, public tokens, and legacy admin credentials never
            enter this Platform surface.
          </p>
        </article>
      </div>

      <IntakeRuntimeWorkspace />

      <section className="mt-7 rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
            Active organization
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Commercial Intake readiness
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
            These limits belong to the selected organization&apos;s commercial
            contract. They do not imply ownership of any project in the global
            legacy runtime above.
          </p>
        </div>

        <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-3">
          <PlatformStatCard
            label="Product access"
            value={intakeEnabled ? "Enabled" : "Not enabled"}
            detail={
              intakeEnabled
                ? "This organization has Intake entitlement capacity."
                : "No Intake form capacity is currently entitled."
            }
          />
          <PlatformStatCard
            label="Form capacity"
            value={formCap === -1 ? "Unlimited" : String(formCap ?? 0)}
            detail={
              "Submission cap: " +
              (submissionsCap === -1
                ? "Unlimited"
                : String(submissionsCap ?? 0)) +
              " monthly."
            }
          />
          <PlatformStatCard
            label="Storage capacity"
            value={
              storageCap === -1
                ? "Unlimited"
                : (storageCap ?? 0).toLocaleString() + " MB"
            }
            detail="Commercial storage entitlement for the tenant-native Intake product."
          />
        </div>

        {!intakeEnabled ? (
          <div className="border-t border-slate-100 p-5 sm:p-6">
            <PlatformEmptyState
              title="Intake is not enabled for this organization"
              description="The global company runtime remains visible to authorized platform operators, but this organization should not receive tenant-native forms or submissions until Intake is commercially enabled."
              actionLabel="Open billing"
              actionHref="/platform/billing"
            />
          </div>
        ) : null}

        <div className="border-t border-slate-100 px-5 py-5 sm:px-6">
          <div className="flex items-center gap-2">
            <Gauge size={16} className="text-violet-600" />
            <h3 className="text-sm font-semibold text-slate-950">
              Current tenant usage signals
            </h3>
          </div>
          {intakeUsage.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No organization-scoped Intake usage events have been recorded yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {intakeUsage.map((entry) => (
                <div
                  key={entry.productFamily + ":" + entry.meterName}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {entry.meterName}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">
                    {entry.totalQuantity}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.eventCount} event
                    {entry.eventCount === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
