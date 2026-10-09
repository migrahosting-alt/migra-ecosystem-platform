import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ArrowRight } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { RevenueExceptionsWorkspace } from "./RevenueExceptionsWorkspace";

export const dynamic = "force-dynamic";

export default async function RevenueExceptionsPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Revenue operations"
        title="Revenue Exceptions"
        description="Read-only exception queue for payment-risk subscriptions, receivables, Stripe ingestion failures, and billing-identity drift. Money-moving actions remain in their owning systems."
        actions={
          <Link
            href="/platform/billing"
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Open MigraPay & Billing <ArrowRight size={15} />
          </Link>
        }
      />
      <RevenueExceptionsWorkspace />
    </div>
  );
}
