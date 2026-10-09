import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { RevenueAnalyticsWorkspace } from "./RevenueAnalyticsWorkspace";

export const dynamic = "force-dynamic";

export default async function RevenueAnalyticsPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Revenue operations"
        title="Revenue Analytics"
        description="Read-only operational billing evidence across invoice flow, receivables, subscriptions, and Stripe ingestion. This surface does not perform accounting revenue recognition."
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
              Open MigraPay & Billing <ArrowRight size={15} />
            </Link>
          </div>
        }
      />
      <RevenueAnalyticsWorkspace />
    </div>
  );
}
