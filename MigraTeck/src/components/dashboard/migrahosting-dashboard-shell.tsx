import type { OrgRole } from "@prisma/client";
import type { ReactNode } from "react";
import { MigraHostingSidebar } from "@/components/dashboard/migrahosting-sidebar";
import { MigraHostingTopbar } from "@/components/dashboard/migrahosting-topbar";

type OrgOption = {
  id: string;
  name: string;
  role: OrgRole;
  isMigraHostingClient: boolean;
};

export function MigraHostingDashboardShell({
  children,
  orgName,
  role,
  organizations,
  activeOrgId,
  supportHref,
  primaryHref,
  primaryLabel,
  userInitial,
  showCloudControl,
}: {
  children: ReactNode;
  orgName: string;
  role: string;
  organizations: OrgOption[];
  activeOrgId?: string;
  supportHref: string;
  primaryHref: string;
  primaryLabel: string;
  userInitial: string;
  showCloudControl: boolean;
}) {
  const navItems = [
    { label: "Overview", href: "/app" },
    ...(showCloudControl ? [{ label: "VPS", href: "/app/vps" }] : []),
    { label: "Services", href: "/app/products" },
    { label: "Files", href: "/app/drive" },
    { label: "Billing", href: "/app/billing" },
    { label: "Organization", href: "/app/orgs" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(236,72,153,0.14),transparent_28%),linear-gradient(180deg,#020617_0%,#0b1120_45%,#020617_100%)]" />
      <div className="absolute inset-0 -z-10 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />

      <div className="flex min-h-screen">
        <aside className="hidden w-[280px] shrink-0 border-r border-white/10 bg-slate-950/70 backdrop-blur xl:block">
          <MigraHostingSidebar
            orgName={orgName}
            role={role}
            navItems={navItems}
            supportHref={supportHref}
          />
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <MigraHostingTopbar
            organizations={organizations}
            title="Hosting Control Plane"
            primaryHref={primaryHref}
            primaryLabel={primaryLabel}
            userInitial={userInitial}
            {...(activeOrgId ? { activeOrgId } : {})}
          />

          <main className="min-w-0 flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
