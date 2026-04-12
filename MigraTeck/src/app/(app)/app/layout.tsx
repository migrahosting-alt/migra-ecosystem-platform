import Link from "next/link";
import { headers } from "next/headers";
import { OrgRole } from "@prisma/client";
import { APP_NAV_ITEMS, type AppNavItem, type AppNavSection } from "@/lib/constants";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { OrgSwitcher } from "@/components/app/org-switcher";
import { LogoutButton } from "@/components/app/logout-button";
import { roleAtLeast } from "@/lib/rbac";
import { orgPrefersVpsWorkspace } from "@/lib/vps/data";
import { isVpsPortalHost, resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

const APP_NAV_SECTION_LABELS: Record<AppNavSection, string> = {
  command: "Command",
  workspace: "Workspace",
  governance: "Governance",
};

function groupNavItems(items: AppNavItem[]) {
  const grouped: Record<AppNavSection, AppNavItem[]> = {
    command: [],
    workspace: [],
    governance: [],
  };

  for (const item of items) {
    grouped[item.section].push(item);
  }

  return grouped;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthSession();
  const activeMembership = await getActiveOrgContext(session.user.id);
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);
  const isVpsHost = isVpsPortalHost(host);
  const navItems = isVpsHost
    ? [
        { href: "/app/vps", label: "Cloud Control", section: "command" },
        { href: "/app/billing", label: "Billing", section: "workspace" },
      ]
    : [...APP_NAV_ITEMS];
  const prefersVps = activeMembership ? await orgPrefersVpsWorkspace(activeMembership) : false;

  if (prefersVps && !isVpsHost) {
    navItems.splice(3, 0, { href: "/app/vps", label: "Cloud Control", section: "command" });
  }

  if (!isVpsHost && activeMembership?.role && roleAtLeast(activeMembership.role, OrgRole.ADMIN)) {
    navItems.push({ href: "/app/platform/ops", label: "Ops", section: "governance" });
    navItems.push({ href: "/app/platform/migradrive/tenants", label: "Drive Ops", section: "governance" });
  }

  if (!isVpsHost && activeMembership?.role === "OWNER") {
    navItems.push({ href: "/app/system", label: "System", section: "governance" });
  }

  const navSections = groupNavItems(navItems);
  const visibleSurfaceCount = navItems.length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[linear-gradient(180deg,rgba(15,122,216,0.06),rgba(255,255,255,0.82))] backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-[1.75rem] border border-[var(--line)] bg-white/88 px-5 py-4 shadow-[0_14px_30px_rgba(10,22,40,0.06)] backdrop-blur-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/" className="text-lg font-black tracking-tight text-[var(--ink)]">
                  {isVpsHost ? authBranding.shortName : "MigraTeck"}
                </Link>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                  {isVpsHost ? "Infrastructure surface" : "Control plane"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-[var(--ink-muted)]">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Organization</p>
                  <p className="mt-1 font-semibold text-[var(--ink)]">{activeMembership?.org.name || "No active organization"}</p>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Authority</p>
                  <p className="mt-1 font-semibold text-[var(--ink)]">{activeMembership?.role || "Unassigned"}</p>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Visible surfaces</p>
                  <p className="mt-1 font-semibold text-[var(--ink)]">{visibleSurfaceCount}</p>
                </div>
                {activeMembership ? (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Org slug</p>
                    <p className="mt-1 font-semibold text-[var(--ink)]">{activeMembership.org.slug}</p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-2)] p-1.5">
                <OrgSwitcher orgs={session.user.organizations} activeOrgId={activeMembership?.orgId} />
              </div>
              <LogoutButton />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {(Object.keys(navSections) as AppNavSection[]).map((section) => (
              <nav
                key={section}
                aria-label={APP_NAV_SECTION_LABELS[section]}
                className="rounded-[1.5rem] border border-[var(--line)] bg-white/88 px-4 py-4 shadow-[0_10px_24px_rgba(10,22,40,0.04)] backdrop-blur-sm"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  {APP_NAV_SECTION_LABELS[section]}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {navSections[section].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-semibold text-[var(--ink-muted)] transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </nav>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-[var(--ink-muted)]">
            <p>
              {isVpsHost
                ? "Provider connectivity, fleet posture, and server lifecycle control remain inside one infrastructure surface."
                : "Identity, products, billing, launch, audit, and operator tooling are grouped as one shared control plane."}
            </p>
            <p className="font-medium text-[var(--ink)]">{session.user.email || "No account email available"}</p>
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
