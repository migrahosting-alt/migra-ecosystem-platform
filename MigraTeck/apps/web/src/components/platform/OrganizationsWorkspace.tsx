"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { PlatformOrganization } from "@/lib/platform";

type OrganizationsWorkspaceProps = {
  initialOrganizations: PlatformOrganization[];
  activeOrgId?: string;
  organizationStats: Record<string, {
    memberCount: number;
    enabledProducts: number;
    billingStatus: string;
    currentPlan: string | null;
  }>;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function OrganizationsWorkspace({
  initialOrganizations,
  activeOrgId,
  organizationStats,
}: OrganizationsWorkspaceProps) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [name, setName] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [switchPendingId, setSwitchPendingId] = useState<string | null>(null);

  const sortedOrganizations = useMemo(
    () => [...organizations].sort((left, right) => left.name.localeCompare(right.name)),
    [organizations],
  );

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    setCreatePending(true);
    setCreateMessage(null);

    try {
      const response = await fetch("/api/platform/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmed,
          slug: slugify(trimmed),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setCreateMessage(payload?.error ?? payload?.error?.message ?? "Unable to create organization.");
        return;
      }

      setOrganizations((current) => [
        ...current,
        {
          id: payload.id,
          name: payload.name,
          slug: payload.slug,
          role: "OWNER",
          joinedAt: new Date().toISOString(),
        },
      ]);
      setName("");
      setCreateMessage("Organization created. You can switch into it now.");
    } catch {
      setCreateMessage("Unable to reach MigraAuth right now.");
    } finally {
      setCreatePending(false);
    }
  }

  async function handleSwitch(orgId: string) {
    setSwitchPendingId(orgId);
    setCreateMessage(null);

    try {
      const response = await fetch("/api/platform/session/org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orgId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setCreateMessage(payload?.error?.message ?? "Unable to switch organization.");
        return;
      }

      window.location.reload();
    } catch {
      setCreateMessage("Unable to switch organization right now.");
    } finally {
      setSwitchPendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Organizations</h2>
            <p className="mt-1 text-sm text-slate-500">
              Every organization gets its own billing, members, and product access boundary.
            </p>
          </div>

          {sortedOrganizations.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              No organizations are attached to this account yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sortedOrganizations.map((organization) => {
                const isActive = activeOrgId === organization.id;
                const stats = organizationStats[organization.id];
                return (
                  <div
                    key={organization.id}
                    className={cn(
                      "flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between",
                      isActive ? "bg-blue-50/50" : "bg-white",
                    )}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{organization.name}</h3>
                        {isActive ? (
                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                            Active
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {organization.slug} • {organization.role}
                      </p>
                      {stats ? (
                        <p className="mt-2 text-xs text-slate-500">
                          {stats.memberCount} member{stats.memberCount === 1 ? "" : "s"} • {stats.enabledProducts} enabled product{stats.enabledProducts === 1 ? "" : "s"} • {stats.currentPlan ?? stats.billingStatus}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSwitch(organization.id)}
                      disabled={isActive || switchPendingId === organization.id}
                      className={cn(
                        "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition",
                        isActive
                          ? "cursor-default border border-slate-200 bg-slate-100 text-slate-500"
                          : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60",
                      )}
                    >
                      {switchPendingId === organization.id ? "Switching..." : isActive ? "Current org" : "Switch"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Create organization</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Start a new workspace when you need a separate billing scope, team, or product setup.
          </p>
          <form className="mt-5 space-y-4" onSubmit={handleCreate}>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Organization name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Northwind Ventures"
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                minLength={2}
                maxLength={160}
                required
              />
            </label>
            <button
              type="submit"
              disabled={createPending}
              className="inline-flex w-full items-center justify-center rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {createPending ? "Creating..." : "Create organization"}
            </button>
          </form>
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
            New organizations are created in MigraAuth and become available across the platform.
          </div>
          {createMessage ? (
            <p className="mt-4 text-sm text-slate-600">{createMessage}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
