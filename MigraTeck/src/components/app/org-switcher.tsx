"use client";

import { OrgRole } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type OrgOption = {
  id: string;
  name: string;
  role: OrgRole;
  isMigraHostingClient: boolean;
};

export function OrgSwitcher({ orgs, activeOrgId }: { orgs: OrgOption[]; activeOrgId?: string | undefined }) {
  const [value, setValue] = useState(activeOrgId || orgs[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const activeOrg = orgs.find((org) => org.id === value) || orgs[0];

  if (!orgs.length) {
    return null;
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <p className="max-w-52 truncate text-sm font-semibold text-[var(--ink)]">{activeOrg?.name}</p>
        {activeOrg ? (
          <>
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              {activeOrg.role}
            </span>
            {activeOrg.isMigraHostingClient ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                Client
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Organization</label>
      <select
        value={value}
        disabled={loading}
        onChange={async (event) => {
          const orgId = event.target.value;
          setValue(orgId);
          setLoading(true);

          await fetch("/api/orgs/switch", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ orgId }),
          });

          setLoading(false);
          router.refresh();
        }}
        className="min-w-56 rounded-lg border border-[var(--line)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]"
      >
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </div>
  );
}
