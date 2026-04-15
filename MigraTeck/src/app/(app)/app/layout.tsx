import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { orgPrefersVpsWorkspace } from "@/lib/vps/data";
import { MigraHostingDashboardShell } from "@/components/dashboard/migrahosting-dashboard-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthSession();
  const activeMembership = await getActiveOrgContext(session.user.id);
  const supportHref = activeMembership?.org.isMigraHostingClient
    ? "mailto:support@migrahosting.com"
    : "mailto:support@migrateck.com";
  const showCloudControl = activeMembership ? await orgPrefersVpsWorkspace(activeMembership) : false;
  const userInitial = (session.user.name || session.user.email || "M").trim().charAt(0).toUpperCase() || "M";

  return (
    <MigraHostingDashboardShell
      orgName={activeMembership?.org.name || "No active organization"}
      role={activeMembership?.role || "Workspace pending"}
      organizations={session.user.organizations}
      supportHref={supportHref}
      primaryHref={showCloudControl ? "/app/vps" : "/app/products"}
      primaryLabel={showCloudControl ? "Create VPS" : "Browse Services"}
      userInitial={userInitial}
      showCloudControl={showCloudControl}
      {...(activeMembership?.orgId ? { activeOrgId: activeMembership.orgId } : {})}
    >
      {!session.user.emailVerified ? (
        <div className="mb-6 rounded-[24px] border border-amber-400/20 bg-amber-400/10 px-5 py-4 text-sm leading-6 text-amber-100/90">
          Email not verified. Verify your email before performing critical organization actions.
        </div>
      ) : null}
      {children}
    </MigraHostingDashboardShell>
  );
}
