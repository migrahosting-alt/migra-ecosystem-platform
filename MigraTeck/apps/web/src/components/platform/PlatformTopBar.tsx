"use client";

import { useState } from "react";
import Link from "next/link";
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
    if (!nextOrgId || nextOrgId === activeOrgId) {
      return;
    }

    setSwitchPending(true);
    try {
      const response = await fetch("/api/platform/session/org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orgId: nextOrgId }),
      });

      if (response.ok) {
        window.location.reload();
      }
    } finally {
      setSwitchPending(false);
    }
  }

  return (
    <header className="border-b border-slate-200/80 bg-white/88 px-6 py-4 backdrop-blur-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              MigraTeck control plane
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">
                {session.activeOrgName ?? "No active organization"}
              </span>
              {session.activeOrgRole ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {session.activeOrgRole}
                </span>
              ) : null}
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Production
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="platform-org-switcher">
              Switch organization
            </label>
            <select
              id="platform-org-switcher"
              value={activeOrgId ?? ""}
              disabled={switchPending || organizations.length === 0}
              onChange={(event) => void handleSwitchOrg(event.target.value)}
              className="min-w-[220px] rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60"
            >
              {organizations.length === 0 ? <option value="">No organizations</option> : null}
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
            >
              Command
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/platform/organizations"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              New org
            </Link>
            <Link
              href="/platform/billing"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Billing
            </Link>
            <Link
              href="/builder/sites"
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Builder
            </Link>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {session.displayName ?? session.email}
              </p>
              <p className="truncate text-xs text-slate-500">{session.email}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
