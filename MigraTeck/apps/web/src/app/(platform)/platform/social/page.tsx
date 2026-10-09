import { requirePermission } from "@migrateck/auth-client";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { SocialConnectionsWorkspace } from "./SocialConnectionsWorkspace";

export const dynamic = "force-dynamic";

export default async function SocialConnectionsPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Infrastructure / Connected providers"
        title="Social Connections"
        description="Operate the OAuth health boundary used by MigraMarketing social publishing. Credentials remain encrypted and server-side; this surface exposes only connection health, provider readiness, and explicit audited reconnect actions."
      />
      <SocialConnectionsWorkspace />
    </div>
  );
}
