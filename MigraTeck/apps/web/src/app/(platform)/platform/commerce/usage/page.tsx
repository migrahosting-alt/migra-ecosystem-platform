import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  Activity,
  ArrowLeft,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { CommerceUsageWorkspace } from "./CommerceUsageWorkspace";

export const dynamic = "force-dynamic";

export default async function CommerceUsagePage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Commerce / Metering operations"
        title="Usage & Metering"
        description="Operate billable product consumption from the canonical ledger: meter definitions, quotas, Stripe export health, retries, and reconciliation evidence."
        actions={
          <Link
            href="/platform/commerce"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Commerce overview
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Waypoints size={19} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Canonical ledger</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Billable events and API telemetry share one usage ledger, while only catalog-backed meter events enter the Stripe export queue.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Gauge size={19} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Quota control</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Per-organization product quotas are visible and auditable, with usage counters updated transactionally during ingestion.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <RefreshCw size={19} className="text-amber-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Retry & reconciliation</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Export failures create operator-visible reconciliation evidence and can be retried without duplicating Stripe meter events.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={19} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Machine-scoped ingest</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Products report usage with scoped API keys. Organization identity comes from the credential, not a caller-controlled header.
          </p>
        </article>
      </div>

      <CommerceUsageWorkspace />
    </div>
  );
}
