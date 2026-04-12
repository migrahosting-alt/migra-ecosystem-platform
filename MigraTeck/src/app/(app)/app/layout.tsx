import Link from "next/link";
import { headers } from "next/headers";
import { OrgRole } from "@prisma/client";
import { APP_NAV_ITEMS } from "@/lib/constants";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { OrgSwitcher } from "@/components/app/org-switcher";
import { LogoutButton } from "@/components/app/logout-button";
import { roleAtLeast } from "@/lib/rbac";
import { orgPrefersVpsWorkspace } from "@/lib/vps/data";
import { isVpsPortalHost, resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthSession();
  const activeMembership = await getActiveOrgContext(session.user.id);
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);
  const isVpsHost = isVpsPortalHost(host);
  const navItems = isVpsHost
    ? [{ href: "/app/vps", label: "VPS" }, { href: "/app/billing", label: "Billing" }]
    : [...APP_NAV_ITEMS];
  const prefersVps = activeMembership ? await orgPrefersVpsWorkspace(activeMembership) : false;

  if (prefersVps && !isVpsHost) {
    navItems.splice(1, 0, { href: "/app/vps", label: "VPS" });
  }

  if (!isVpsHost && activeMembership?.role && roleAtLeast(activeMembership.role, OrgRole.ADMIN)) {
    navItems.push({ href: "/app/platform/ops", label: "Ops" });
    navItems.push({ href: "/app/platform/migradrive/tenants", label: "Drive Ops" });
  }

  if (!isVpsHost && activeMembership?.role === "OWNER") {
    navItems.push({ href: "/app/system", label: "System" });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-6 py-4">
          <Link href="/" className="mr-4 text-lg font-black tracking-tight">
            {isVpsHost ? authBranding.shortName : "MigraTeck"}
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <OrgSwitcher orgs={session.user.organizations} activeOrgId={activeMembership?.orgId} />
            <LogoutButton />
          </div>
        </div>
      </header>
      {!session.user.emailVerified ? (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          Email not verified. Verify your email before performing critical organization actions.
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
