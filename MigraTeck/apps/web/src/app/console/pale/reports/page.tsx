import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { Lock, ShieldCheck, AlertTriangle } from "lucide-react";

import { getSession } from "../../lib/auth";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { SectionCard } from "../../components/SectionCard";
import { isPaleDbConfigured } from "../../lib/pale-db";
import { getPaleReports } from "../../lib/pale-live";
import {
  getPaleRole,
  canViewReports,
  canMutateReports,
  maskPhone,
  paleRoleLabel,
} from "../../lib/pale-rbac";
import { isBridgeConfigured } from "../../lib/pale-admin";
import { ReportActions } from "./ReportActions";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  pending: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  reviewing: "border-sky-400/20 bg-sky-500/10 text-sky-300",
  reviewed: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  dismissed: "border-slate-400/20 bg-slate-500/10 text-slate-400",
  actioned: "border-violet-400/20 bg-violet-500/10 text-violet-300",
  escalated: "border-rose-400/20 bg-rose-500/10 text-rose-300",
};

const relative = (iso: string | null): string => {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <th className={`px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500 ${right ? "text-right" : "text-left"}`}>{children}</th>
);
const Td = ({ children, right, className = "" }: { children: ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-2 py-2.5 align-middle text-[12px] ${right ? "text-right" : "text-left"} ${className}`}>{children}</td>
);

export default async function PaleReportsPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const role = getPaleRole(session);
  if (!canViewReports(role)) {
    return (
      <ConsolePageShell session={session} activePath="/console/pale" title="Pale — Reports" subtitle="Restricted">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10">
            <Lock className="h-6 w-6 text-rose-300" />
          </span>
          <h1 className="text-xl font-semibold text-white">Access denied</h1>
          <p className="max-w-sm text-sm text-slate-400">Reports require an Owner, Admin, Trust &amp; Safety Manager, Moderator, or Auditor role.</p>
          <Link href="/console/pale" className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-white/10">Back to Pale Control Center</Link>
        </div>
      </ConsolePageShell>
    );
  }

  const dbConfigured = isPaleDbConfigured();
  const reports = dbConfigured ? await getPaleReports(25) : [];
  const mayMutate = canMutateReports(role);
  const bridgeReady = isBridgeConfigured();

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/pale"
      title="Pale — Reports"
      subtitle="Trust & Safety report queue. Phase 2A: Mark reviewing only (audited)."
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-300">
          <ShieldCheck className="h-3 w-3" /> {role ? paleRoleLabel(role) : ""}{mayMutate ? " · can review" : " · read-only"}
        </span>
      }
    >
      <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Link href="/console/ecosystem" className="hover:text-slate-300">Apps</Link><span>/</span>
        <Link href="/console/pale" className="hover:text-slate-300">Pale</Link><span>/</span>
        <span className="text-slate-300">Reports</span>
      </div>

      {mayMutate && !bridgeReady && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-500/[0.06] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            Staff bridge not configured (<code className="rounded bg-black/30 px-1">PALE_ADMIN_BRIDGE_KEY</code>): the
            Mark-reviewing action will return an error until the console + pale-api share the key.
          </p>
        </div>
      )}

      <SectionCard title="Reports" subtitle={dbConfigured ? `${reports.length} most recent` : undefined}>
        {!dbConfigured ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
            Pale DB not configured — no live reports.
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
            No reports.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead><tr><Th>Report</Th><Th>Type</Th><Th>Reason</Th><Th>Reporter</Th><Th>Status</Th><Th>Created</Th><Th right>Actions</Th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {reports.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-slate-400">{r.id.slice(0, 8)}</Td>
                  <Td className="text-slate-200">{r.targetType}</Td>
                  <Td className="max-w-[16rem] truncate text-slate-400">{r.reason}</Td>
                  <Td className="font-mono text-slate-400">{maskPhone(r.reporterPhone)}</Td>
                  <Td>
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[r.status] ?? STATUS_BADGE.pending}`}>{r.status}</span>
                  </Td>
                  <Td className="text-slate-500">{relative(r.createdAt)}</Td>
                  <Td right><ReportActions reportId={r.id} status={r.status} canMutate={mayMutate} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          Phase 2A — only <span className="text-slate-300">Mark reviewing</span> is enabled, routed through the audited
          pale-api admin endpoint (RBAC + audit log). Dismiss / escalate / resolve and all account actions remain
          disabled. No private content is shown; reporter phones are masked.
        </p>
      </div>
    </ConsolePageShell>
  );
}
