import { requirePermission } from "@migrateck/auth-client";
import { MembersWorkspace } from "@/components/platform/MembersWorkspace";
import { PlatformEmptyState } from "@/components/platform/PlatformEmptyState";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  if (!session.activeOrgId || !session.activeOrgName) {
    return (
      <div className="p-6 lg:p-8">
        <PlatformPageHeader
          eyebrow="Team access"
          title="Members"
          description="Team access is attached to an active organization. Select or create one first."
        />
        <PlatformEmptyState
          title="No active organization selected"
          description="Choose an organization before you manage members, assign roles, or invite teammates."
          actionLabel="Go to organizations"
          actionHref="/platform/organizations"
        />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Team access"
        title="Members"
        description={`Manage who can work inside ${session.activeOrgName}, what role they hold, and how ownership is distributed.`}
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <PlatformStatCard
          label="Active organization"
          value={session.activeOrgName}
          detail="This is the team boundary currently applied to the platform session."
        />
        <PlatformStatCard
          label="Your role"
          value={session.activeOrgRole ?? "No role"}
          detail="Role enforcement happens in MigraAuth and is reflected into this app session."
        />
        <PlatformStatCard
          label="Access scope"
          value={`${session.permissions.length} perms`}
          detail="Platform permissions determine which team and billing actions are available."
        />
      </div>

      <MembersWorkspace
        orgId={session.activeOrgId}
        orgName={session.activeOrgName}
        canManageMembers={session.permissions.includes("orgs.manage") || ["OWNER", "ADMIN"].includes(session.activeOrgRole ?? "")}
        currentUserEmail={session.email}
        {...(session.displayName ? { currentUserName: session.displayName } : {})}
        {...(session.activeOrgRole ? { currentUserRole: session.activeOrgRole } : {})}
      />
    </div>
  );
}
