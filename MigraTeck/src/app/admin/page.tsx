import { OrgRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { isPlatformOwner } from "@/lib/platform-config";
import { roleAtLeast } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAuthSession();
  const [activeMembership, platformOwner] = await Promise.all([
    getActiveOrgContext(session.user.id),
    isPlatformOwner(session.user.id),
  ]);

  if (platformOwner) {
    redirect("/app/platform/settings");
  }

  if (activeMembership?.role && roleAtLeast(activeMembership.role, OrgRole.ADMIN)) {
    redirect("/app/platform/ops");
  }

  redirect("/app");
}
