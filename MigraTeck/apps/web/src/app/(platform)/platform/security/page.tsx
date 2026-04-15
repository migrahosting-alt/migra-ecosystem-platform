import { requirePermission } from "@migrateck/auth-client";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { SecurityWorkspace } from "@/components/platform/SecurityWorkspace";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Identity and protection"
        title="Security"
        description="Manage active sessions, multi-factor authentication, and password controls. All identity operations are backed by MigraAuth."
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <PlatformStatCard
          label="Identity provider"
          value="MigraAuth"
          detail="Authentication, sessions, MFA, and password recovery are centralized."
        />
        <PlatformStatCard
          label="Active role"
          value={session.activeOrgRole ?? "No role"}
          detail="Role context determines what security-sensitive actions are visible."
        />
        <PlatformStatCard
          label="Session expiry"
          value={new Date(session.expiresAt).toLocaleDateString()}
          detail={`Current session created ${new Date(session.createdAt).toLocaleString()}.`}
        />
      </div>

      <SecurityWorkspace sessionExpiresAt={session.expiresAt} />
    </div>
  );
}
