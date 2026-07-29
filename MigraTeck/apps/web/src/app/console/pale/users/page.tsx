import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { Lock, ShieldCheck, Users, AlertTriangle } from "lucide-react";

import { getSession } from "../../lib/auth";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { SectionCard } from "../../components/SectionCard";
import { isPaleDbConfigured } from "../../lib/pale-db";
import {
  getPaleAccounts,
  getAccountStatusCounts,
  ACCOUNT_STATUSES,
  type AccountFilters,
} from "../../lib/pale-live";
import {
  getPaleRole,
  canViewAccounts,
  canSuspendAccounts,
  canBanAccounts,
  maskPhone,
  maskEmail,
  paleRoleLabel,
} from "../../lib/pale-rbac";
import { safeDisplayName } from "../../lib/pale-dashboard";
import { isBridgeConfigured } from "../../lib/pale-admin";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  suspended: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  banned: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  deactivated: "border-slate-400/20 bg-slate-500/10 text-slate-400",
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

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

const FIELD = "rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-slate-200 focus:border-fuchsia-400/40 focus:outline-none";

export default async function PaleUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const role = getPaleRole(session);
  if (!canViewAccounts(role)) {
    return (
      <ConsolePageShell session={session} activePath="/console/pale" title="Pale — Accounts" subtitle="Restricted">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10">
            <Lock className="h-6 w-6 text-rose-300" />
          </span>
          <h1 className="text-xl font-semibold text-white">Access denied</h1>
          <p className="max-w-sm text-sm text-slate-400">Account controls require an Owner, Admin, Trust &amp; Safety Manager, Moderator, or Auditor role.</p>
          <Link href="/console/pale" className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-white/10">Back to Pale Control Center</Link>
        </div>
      </ConsolePageShell>
    );
  }

  const sp = await searchParams;
  const statusParam = first(sp.status);
  const status = statusParam && (ACCOUNT_STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined;
  const roleParam = first(sp.role)?.trim() || undefined;
  const q = first(sp.q)?.trim() || undefined;
  const fromRaw = first(sp.from);
  const toRaw = first(sp.to);
  const from = isDate(fromRaw) ? fromRaw : undefined;
  const to = isDate(toRaw) ? `${toRaw} 23:59:59` : undefined;
  const filters: AccountFilters = {
    limit: 50,
    ...(status ? { status } : {}),
    ...(roleParam ? { role: roleParam } : {}),
    ...(q ? { query: q } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const dbConfigured = isPaleDbConfigured();
  const [users, counts] = dbConfigured
    ? await Promise.all([getPaleAccounts(filters), getAccountStatusCounts()])
    : [[], {} as Record<string, number>];
  const mayAct = canSuspendAccounts(role) || canBanAccounts(role);
  const bridgeReady = isBridgeConfigured();
  const filtersActive = !!(status || roleParam || q || from || to);

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/pale"
      title="Pale — Accounts"
      subtitle="User account controls. Suspend / ban / restore (audited, RBAC). Identity masked."
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-300">
          <ShieldCheck className="h-3 w-3" /> {role ? paleRoleLabel(role) : ""}{mayAct ? " · can act" : " · read-only"}
        </span>
      }
    >
      <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Link href="/console/ecosystem" className="hover:text-slate-300">Apps</Link><span>/</span>
        <Link href="/console/pale" className="hover:text-slate-300">Pale</Link><span>/</span>
        <span className="text-slate-300">Accounts</span>
      </div>

      {dbConfigured && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACCOUNT_STATUSES.map((s) => (
            <div key={s} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
              <div className="text-[9px] font-medium uppercase tracking-wider text-slate-500">{s}</div>
              <div className={`text-lg font-bold tracking-tight ${(counts[s] ?? 0) > 0 ? "text-white" : "text-slate-600"}`}>{counts[s] ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {mayAct && !bridgeReady && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-500/[0.06] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            Staff bridge not configured (<code className="rounded bg-black/30 px-1">PALE_ADMIN_BRIDGE_KEY</code>): account
            actions will return an error until the console + pale-api share the key.
          </p>
        </div>
      )}

      {dbConfigured && (
        <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-600">Search</span>
            <input name="q" defaultValue={q ?? ""} placeholder="username, name…" className={`${FIELD} w-40`} aria-label="Search accounts" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-600">Status</span>
            <select name="status" defaultValue={status ?? ""} className={FIELD} aria-label="Filter by status">
              <option value="">All</option>
              {ACCOUNT_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-600">Role</span>
            <input name="role" defaultValue={roleParam ?? ""} placeholder="moderator…" className={`${FIELD} w-32`} aria-label="Filter by role" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-600">From</span>
            <input type="date" name="from" defaultValue={fromRaw && isDate(fromRaw) ? fromRaw : ""} className={FIELD} aria-label="Created from" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-600">To</span>
            <input type="date" name="to" defaultValue={toRaw && isDate(toRaw) ? toRaw : ""} className={FIELD} aria-label="Created to" />
          </label>
          <button type="submit" className="rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1.5 text-[11px] font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20">Apply</button>
          {filtersActive && (
            <Link href="/console/pale/users" className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/10">Clear</Link>
          )}
        </form>
      )}

      <SectionCard title="Accounts" subtitle={dbConfigured ? `${users.length}${filtersActive ? " filtered" : " most recent"}` : undefined}>
        {!dbConfigured ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
            Pale DB not configured — no live accounts.
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
            {filtersActive ? "No accounts match these filters." : "No accounts."}
          </div>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse">
              <thead><tr><Th>Account</Th><Th>Status</Th><Th>Roles</Th><Th>Country</Th><Th>Last active</Th><Th>Joined</Th><Th right>Open</Th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {users.map((u) => {
                  const name = safeDisplayName(u.name, u.username, u.phone);
                  return (
                    <tr key={u.id}>
                      <Td>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-slate-100">{name}</span>
                          <span className="truncate font-mono text-[10px] text-slate-500">{maskPhone(u.phone)}{u.email ? ` · ${maskEmail(u.email)}` : ""} · {u.id.slice(0, 8)}</span>
                        </div>
                      </Td>
                      <Td><span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[u.status] ?? STATUS_BADGE.deactivated}`}>{u.status}</span></Td>
                      <Td className="text-slate-400">{u.roles.length ? u.roles.join(", ") : "—"}</Td>
                      <Td className="text-slate-400">{u.country ?? "—"}</Td>
                      <Td className="text-slate-500">{relative(u.lastActive)}</Td>
                      <Td className="text-slate-500">{relative(u.createdAt)}</Td>
                      <Td right>
                        <Link href={`/console/pale/users/${u.id}`} className="inline-flex items-center rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-2 py-1 text-[10px] font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20">Manage</Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          Account actions (suspend / ban / restore) live in each account&apos;s detail view, are RBAC-gated and audited, and
          require a reason. No full phones, emails, OTPs, tokens, or private content are shown — identity is masked.
        </p>
      </div>
    </ConsolePageShell>
  );
}
