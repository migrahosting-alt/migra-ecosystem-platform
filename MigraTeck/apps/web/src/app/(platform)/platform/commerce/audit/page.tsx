import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { CommerceAuditWorkspace } from "./CommerceAuditWorkspace";

export const dynamic = "force-dynamic";

export default async function CommerceAuditPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Commercial evidence"
        title="Commerce Audit"
        description="Read-only global evidence for billing, entitlements, provisioning, revenue handoffs, and usage operations. Sensitive metadata is redacted server-side before it reaches this workspace."
      />
      <CommerceAuditWorkspace />
    </div>
  );
}
