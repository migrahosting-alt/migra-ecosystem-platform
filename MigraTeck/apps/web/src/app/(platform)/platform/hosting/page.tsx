import { requirePermission } from "@migrateck/auth-client";
import Link from "next/link";
import { ArrowRight, Gauge, ShieldCheck, Server } from "lucide-react";
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
import { HostingWorkspace } from "./HostingWorkspace";

export const dynamic = "force-dynamic";

export default async function HostingPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const commercial = await getCommercialSnapshot(session.activeOrgId);
  const currentPlan = getCurrentCommercialPlan(commercial.subscriptions);
  const hostingEnabled = hasProductAccess(commercial.entitlements, "hosting");
  const workloadCap = getNumericEntitlement(commercial.entitlements, "hosting.vps.max");
  const bandwidthCap = getNumericEntitlement(
    commercial.entitlements,
    "hosting.bandwidth.monthly_gb",
  );
  const storageCap = getNumericEntitlement(commercial.entitlements, "hosting.storage_gb");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Infrastructure / MigraHosting"
        title="Hosting"
        description="Live organization-scoped Hosting visibility from MigraPanel, anchored to MigraTeck identity, entitlements, and trust. Operational execution remains in MigraPanel."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/platform/billing"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Review Hosting billing
            </Link>
            <Link
              href="/platform/security"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Security posture <ArrowRight size={14} />
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <PlatformStatCard
          label="Current plan"
          value={currentPlan?.planCode ?? "Not enabled"}
          detail={
            hostingEnabled
              ? "Hosting access is commercially enabled for the active organization."
              : "Hosting is not commercially enabled for the active organization."
          }
        />
        <PlatformStatCard
          label="Workload capacity"
          value={workloadCap === -1 ? "Unlimited" : String(workloadCap ?? 0)}
          detail={"Bandwidth: " + (bandwidthCap ?? 0) + " GB monthly · Storage: " + (storageCap ?? 0) + " GB."}
        />
        <PlatformStatCard
          label="Runtime authority"
          value="MigraPanel"
          detail="ResourceNode binds this organization to one authoritative MigraPanel tenant; runtime inventory is read live."
        />
      </div>

      {!hostingEnabled ? (
        <div className="mb-6">
          <PlatformEmptyState
            title="Hosting is not enabled for this organization"
            description="Existing runtime state can still be inspected by authorized operators, but new provisioning should remain blocked until Hosting is commercially enabled."
            actionLabel="Open billing"
            actionHref="/platform/billing"
          />
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Server size={18} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Observe here</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Websites, domains, SSL, deployments, and provisioning signals are scoped to the linked tenant.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Gauge size={18} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Operate in MigraPanel</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Suspend, deploy, back up, edit runtime, manage SFTP, databases, and environment settings in the operational control center.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={18} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Explicit identity bridge</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Tenant linkage is never guessed from names or domains; platform-owner authority creates the cross-system binding.
          </p>
        </article>
      </div>

      <HostingWorkspace hostingEnabled={hostingEnabled} />
    </div>
  );
}
