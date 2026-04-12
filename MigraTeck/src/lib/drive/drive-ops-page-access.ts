import { OrgRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { isPlatformOwner } from "@/lib/platform-config";
import { roleAtLeast } from "@/lib/rbac";

export interface DriveOpsPageAccess {
  userId: string;
  platformOwner: boolean;
  activeOrg: Awaited<ReturnType<typeof getActiveOrgContext>>;
}

export async function requireDriveOpsPageAccess(): Promise<DriveOpsPageAccess> {
  const session = await requireAuthSession();
  const [activeOrg, platformOwner] = await Promise.all([
    getActiveOrgContext(session.user.id),
    isPlatformOwner(session.user.id),
  ]);

  const hasAdminRole = Boolean(activeOrg?.role && roleAtLeast(activeOrg.role, OrgRole.ADMIN));
  if (!platformOwner && !hasAdminRole) {
    redirect("/app");
  }

  return {
    userId: session.user.id,
    platformOwner,
    activeOrg,
  };
}

export function canAccessDriveTenantOrg(access: DriveOpsPageAccess, orgId: string): boolean {
  return access.platformOwner || access.activeOrg?.orgId === orgId;
}