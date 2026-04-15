import Link from "next/link";
import { MigraHostingOrgSwitcher } from "@/components/dashboard/migrahosting-org-switcher";
import { MigraHostingSignOutButton } from "@/components/dashboard/migrahosting-signout-button";

type OrgOption = {
  id: string;
  name: string;
  role: import("@prisma/client").OrgRole;
  isMigraHostingClient: boolean;
};

export function MigraHostingTopbar({
  organizations,
  activeOrgId,
  title,
  primaryHref,
  primaryLabel,
  userInitial,
}: {
  organizations: OrgOption[];
  activeOrgId?: string;
  title: string;
  primaryHref: string;
  primaryLabel: string;
  userInitial: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/75 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/40">
            MigraHosting
          </p>
          <h1 className="truncate text-base font-semibold tracking-[-0.02em] text-white">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/app/products"
            className="hidden h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white/75 transition hover:bg-white/[0.06] hover:text-white md:inline-flex"
          >
            Services
          </Link>

          <Link
            href={primaryHref}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#7c3aed_0%,#ec4899_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.25)] transition hover:opacity-95"
          >
            {primaryLabel}
          </Link>

          <MigraHostingOrgSwitcher
            orgs={organizations}
            {...(activeOrgId ? { activeOrgId } : {})}
          />
          <MigraHostingSignOutButton />

          <div className="flex h-10 min-w-[44px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white">
            {userInitial}
          </div>
        </div>
      </div>
    </header>
  );
}
