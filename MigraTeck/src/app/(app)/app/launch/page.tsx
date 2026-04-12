import { LaunchBuilderWorkspace } from "@/components/app/launch-builder-workspace";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { isInternalOrg } from "@/lib/security/internal-org";

export default async function LaunchWorkspacePage() {
  const session = await requireAuthSession();
  const activeMembership = await getActiveOrgContext(session.user.id);

  if (!activeMembership) {
    return <p>No active organization. Create or join one first.</p>;
  }

  const canStartLaunch = activeMembership.org.isMigraHostingClient || isInternalOrg(activeMembership.org);

  return (
    <LaunchBuilderWorkspace orgName={activeMembership.org.name} canStartLaunch={canStartLaunch} />
  );
}
