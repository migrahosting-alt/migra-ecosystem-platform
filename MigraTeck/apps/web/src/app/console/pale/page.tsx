import { redirect } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";

import { getSession } from "../lib/auth";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { getPaleDashboardView } from "../lib/pale-dashboard";
import { getPaleRole, hasPaleReadAccess, paleRoleLabel } from "../lib/pale-rbac";
import { PaleControlCenterBody } from "./PaleControlCenterBody";

export const dynamic = "force-dynamic";

export default async function PaleControlCenter() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const role = getPaleRole(session);

  if (!hasPaleReadAccess(role)) {
    return (
      <ConsolePageShell session={session} activePath="/console/pale" title="Pale Control Center" subtitle="Restricted module">
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10"><Lock className="h-6 w-6 text-rose-300" /></span>
          <h1 className="text-xl font-semibold text-white">Access denied</h1>
          <p className="max-w-sm text-sm text-slate-400">The Pale Control Center requires an Owner, Admin, Trust &amp; Safety Manager, or Read-only Auditor role.{role ? ` Your role (${role}) is not permitted.` : ""}</p>
          <Link href="/console" className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-white/10">Back to Overview</Link>
        </div>
      </ConsolePageShell>
    );
  }

  const d = await getPaleDashboardView();
  const roleLabel = role ? paleRoleLabel(role) : "";

  return (
    <ConsolePageShell session={session} activePath="/console/pale" title="Pale">
      <PaleControlCenterBody view={d} roleLabel={roleLabel} />
    </ConsolePageShell>
  );
}
