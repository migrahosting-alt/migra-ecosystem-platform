import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ArrowRight, BadgeDollarSign, TriangleAlert } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { BillingReadinessWorkspace } from "./BillingReadinessWorkspace";

export const dynamic = "force-dynamic";

export default async function BillingReadinessPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Commerce control plane"
        title="Billing Readiness"
        description="Read-only verification of Stripe webhook registration, canonical event coverage, delivery evidence, and billing-ledger reconciliation."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/platform/commerce/exceptions"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <TriangleAlert size={15} />
              Revenue Exceptions
            </Link>
            <Link
              href="/platform/billing"
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              <BadgeDollarSign size={15} />
              MigraPay & Billing <ArrowRight size={15} />
            </Link>
          </div>
        }
      />
      <BillingReadinessWorkspace />
    </div>
  );
}
