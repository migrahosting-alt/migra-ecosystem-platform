import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ArrowRight } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { CommerceOverviewWorkspace } from "./CommerceOverviewWorkspace";

export const dynamic = "force-dynamic";

export default async function CommerceOverviewPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Commercial infrastructure"
        title="Commerce"
        description="Global operator command center for MigraPay, product catalog, organization entitlements, usage metering, Stripe processor readiness, provisioning, and reconciliation evidence."
        actions={
          <Link
            href="/platform/billing"
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Open MigraPay & Billing <ArrowRight size={15} />
          </Link>
        }
      />

      <CommerceOverviewWorkspace />

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">
          Commercial authority rule
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
          Products may request purchases and report usage, but they do not own
          canonical prices, charge amounts, subscription state, invoice state,
          or entitlements. Stripe and other processors are downstream
          processors; MigraPay remains the commercial system of record.
        </p>
      </section>
    </div>
  );
}
