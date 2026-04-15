import { requirePermission } from "@migrateck/auth-client";
import { BillingWorkspace } from "@/components/platform/BillingWorkspace";
import { PlatformEmptyState } from "@/components/platform/PlatformEmptyState";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  const hasOrg = !!session.activeOrgId;

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Commercial control"
        title="Billing"
        description="Review the commercial state of the active organization — subscriptions, invoices, and payment methods."
      />

      {!hasOrg ? (
        <PlatformEmptyState
          title="No billing workspace yet"
          description="Create an organization first. Once that exists, billing, payment methods, and commercial entitlements can be attached to it."
          actionLabel="Create organization"
          actionHref="/platform/organizations"
        />
      ) : (
        <BillingWorkspace />
      )}
    </div>
  );
}
