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

export function MigraHostingOrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: OrgOption[];
  activeOrgId?: string;
}) {
  const [value, setValue] = useState(activeOrgId || orgs[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (!orgs.length) {
    return null;
  }

  return (
    <label className="hidden min-w-[220px] rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-white/80 lg:block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
        Organization
      </span>
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
        className="w-full bg-transparent text-sm font-medium text-white outline-none"
      >
        {orgs.map((org) => (
          <option key={org.id} value={org.id} className="bg-slate-950 text-white">
            {org.name}
          </option>
        ))}
      </select>
    </label>
  );
}
