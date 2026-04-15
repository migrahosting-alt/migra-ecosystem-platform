import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformSidebar } from "@/components/platform/PlatformSidebar";
import { PlatformTopBar } from "@/components/platform/PlatformTopBar";
import { getPlatformOrganizations } from "@/lib/platform";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const organizations = getPlatformOrganizations(session);

  return (
    <div className="fixed inset-0 z-[100] flex bg-slate-950">
      <PlatformSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <PlatformTopBar
          {...(session.activeOrgId ? { activeOrgId: session.activeOrgId } : {})}
          organizations={organizations}
          session={{
            email: session.email,
            ...(session.displayName ? { displayName: session.displayName } : {}),
            ...(session.activeOrgName ? { activeOrgName: session.activeOrgName } : {}),
            ...(session.activeOrgRole ? { activeOrgRole: session.activeOrgRole } : {}),
          }}
        />
        <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.08),transparent_28%),linear-gradient(180deg,#f8fafc,#eef2ff_140%)]">
          {children}
        </main>
      </div>
    </div>
  );
}
