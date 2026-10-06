"use client";

import Link from "next/link";
import { useState } from "react";
import { Code2, CreditCard, Search, ShieldCheck } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import type { PlatformOrganization } from "@/lib/platform";

interface PlatformTopBarProps {
  activeOrgId?: string;
  organizations: PlatformOrganization[];
  session: {
    email: string;
    displayName?: string;
    activeOrgName?: string;
    activeOrgRole?: string;
  };
}

export function PlatformTopBar({ activeOrgId, organizations, session }: PlatformTopBarProps) {
  const [switchPending, setSwitchPending] = useState(false);

  async function handleSwitchOrg(nextOrgId: string) {
    if (!nextOrgId || nextOrgId === activeOrgId) return;

    setSwitchPending(true);
    try {
      const response = await fetch("/api/platform/session/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: nextOrgId }),
      });

      if (response.ok) window.location.reload();
    } finally {
      setSwitchPending(false);
    }
  }

  return (
    <header className="border-b border-white/8 bg-[linear-gradient(180deg,#05080f,#0a101b)] px-5 py-2.5 text-slate-100 shadow-[0_8px_24px_rgba(2,6,23,0.14)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="min-w-[160px]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              MigraTeck Platform
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-white">
                {session.activeOrgName ?? "Platform context"}
              </span>
              {session.activeOrgRole ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                  {session.activeOrgRole}
                </span>
              ) : null}
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Production
              </span>
            </div>
          </div>

          <div className="relative hidden min-w-0 max-w-xl flex-1 lg:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              aria-label="Search MigraTeck platform"
              placeholder="Search organizations, API access, billing, events..."
              className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.055] pl-9 pr-3 text-[13px] text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-400/70 focus:bg-white/[0.08] focus:ring-2 focus:ring-blue-500/15"
            />
          </div>

          <select
            id="platform-org-switcher"
            value={activeOrgId ?? ""}
            disabled={switchPending || organizations.length === 0}
            onChange={(event) => void handleSwitchOrg(event.target.value)}
            className="hidden min-w-[170px] rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] font-medium text-slate-100 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-50 2xl:block"
          >
            {organizations.length === 0 ? <option value="">No organization selected</option> : null}
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <nav className="hidden items-center gap-1 lg:flex">
            <Link
              href="/platform/developers"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              <Code2 size={16} /> Developers
            </Link>
            <Link
              href="/platform/commerce"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              <CreditCard size={16} /> Commerce
            </Link>
            <Link
              href="/platform/trust"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              <ShieldCheck size={16} /> Trust
            </Link>
          </nav>

          <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.055] px-2.5 py-1.5">
            <div className="min-w-0">
              <p className="max-w-[160px] truncate text-[13px] font-semibold text-white">
                {session.displayName ?? session.email}
              </p>
              <p className="max-w-[160px] truncate text-[11px] text-slate-400">{session.email}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
