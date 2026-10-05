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
    <header className="border-b border-slate-200/80 bg-white/92 px-6 py-3.5 backdrop-blur-xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="min-w-[175px]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              MigraTeck Platform
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-900">
                {session.activeOrgName ?? "Platform context"}
              </span>
              {session.activeOrgRole ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
            />
          </div>

          <select
            id="platform-org-switcher"
            value={activeOrgId ?? ""}
            disabled={switchPending || organizations.length === 0}
            onChange={(event) => void handleSwitchOrg(event.target.value)}
            className="hidden min-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-50 2xl:block"
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
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <Code2 size={16} /> Developers
            </Link>
            <Link
              href="/platform/commerce"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <CreditCard size={16} /> Commerce
            </Link>
            <Link
              href="/platform/trust"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <ShieldCheck size={16} /> Trust
            </Link>
          </nav>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <p className="max-w-[180px] truncate text-sm font-semibold text-slate-900">
                {session.displayName ?? session.email}
              </p>
              <p className="max-w-[180px] truncate text-xs text-slate-500">{session.email}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
