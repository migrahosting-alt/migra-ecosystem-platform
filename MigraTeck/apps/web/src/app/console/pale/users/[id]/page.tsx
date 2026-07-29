import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, ArrowLeft, AlertTriangle } from "lucide-react";

import { getSession } from "../../../lib/auth";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { SectionCard } from "../../../components/SectionCard";
import { isPaleDbConfigured } from "../../../lib/pale-db";
import { getPaleAccount, getPaleUserAuditEvents, type LiveAuditEvent } from "../../../lib/pale-live";
import {
  getPaleRole,
  canViewAccounts,
  canSuspendAccounts,
  canBanAccounts,
  canRestoreAccounts,
  maskPhone,
  maskEmail,
} from "../../../lib/pale-rbac";
import { isBridgeConfigured } from "../../../lib/pale-admin";
import { shortId, absolute, maskActor, safeDisplayName } from "../../../lib/pale-dashboard";
import { UserAccountActions } from "../UserAccountActions";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  suspended: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  banned: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  deactivated: "border-slate-400/20 bg-slate-500/10 text-slate-400",
};
const ACTION_DOT: Record<string, string> = { danger: "bg-rose-400", ok: "bg-emerald-400", warn: "bg-amber-400" };
const tone = (a: string) => {
  const u = a.toUpperCase();
  if (u.includes("BAN") || u.includes("SUSPEND") || u.includes("DELETE")) return "danger";
  if (u.includes("RESTORE") || u.includes("RESOLVE")) return "ok";
  return "warn";
};
const prettyAction = (a: string) => a.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
/** Mask an actor that may be an email (onBehalfOf) or a username. */
const maskWho = (s: string | null): string => {
  if (!s) return "—";
  const at = s.indexOf("@");
  if (at > 0) return `${s.slice(0, 2)}•••@${s.slice(at + 1)}`;
  return maskActor(s);
};

export default async function PaleUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const role = getPaleRole(session);
  if (!canViewAccounts(role)) redirect("/console/pale/users");

  const { id } = await params;
  const dbConfigured = isPaleDbConfigured();
  const [user, events] = dbConfigured
    ? await Promise.all([getPaleAccount(id), getPaleUserAuditEvents(id)])
    : [null, [] as LiveAuditEvent[]];

  const mayAct = canSuspendAccounts(role) || canBanAccounts(role) || canRestoreAccounts(role);
  const bridgeReady = isBridgeConfigured();
  const maskedName = user ? safeDisplayName(user.name, user.username, user.phone) : "";

  return (
    <ConsolePageShell session={session} activePath="/console/pale" title="Pale — Account" subtitle="Account detail, status history & controls (audited, masked)">
      <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Link href="/console/pale" className="hover:text-slate-300">Pale</Link><span>/</span>
        <Link href="/console/pale/users" className="hover:text-slate-300">Accounts</Link><span>/</span>
        <span className="font-mono text-slate-300">{shortId(id)}</span>
      </div>

      <Link href="/console/pale/users" className="inline-flex w-fit items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to accounts
      </Link>

      {!user ? (
        <SectionCard title="Account">
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
            {dbConfigured ? "Account not found." : "Pale DB not configured."}
          </div>
        </SectionCard>
      ) : (
        <>
          <SectionCard
            title="Account"
            subtitle={`#${shortId(user.id)}`}
            actions={
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[user.status] ?? STATUS_BADGE.deactivated}`}>{user.status}</span>
            }
          >
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {[
                ["Name", <span key="n" className="text-slate-200">{maskedName}</span>],
                ["Phone", <span key="p" className="font-mono text-slate-400">{maskPhone(user.phone)}</span>],
                ["Email", <span key="e" className="font-mono text-slate-400">{maskEmail(user.email) ?? "—"}</span>],
                ["Roles", <span key="r" className="text-slate-300">{user.roles.length ? user.roles.join(", ") : "—"}</span>],
                ["Country", <span key="c" className="text-slate-300">{user.country ?? "—"}</span>],
                ["Created", <span key="cr" className="text-slate-400">{absolute(user.createdAt)}</span>],
                ["Last active", <span key="la" className="text-slate-400">{absolute(user.lastActive)}</span>],
              ].map(([label, val]) => (
                <div key={label as string} className="flex flex-col gap-0.5">
                  <dt className="text-[9px] font-medium uppercase tracking-wider text-slate-600">{label}</dt>
                  <dd className="text-[12px]">{val}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          {mayAct && (
            <SectionCard title="Actions" subtitle="Audited · reason required">
              {!bridgeReady && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-500/[0.06] px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <p className="text-[11px] text-amber-200/90">Staff bridge not configured — actions will return an error until the key is set.</p>
                </div>
              )}
              <UserAccountActions
                userId={user.id}
                status={user.status}
                maskedName={maskedName}
                canSuspend={canSuspendAccounts(role)}
                canBan={canBanAccounts(role)}
                canRestore={canRestoreAccounts(role)}
              />
            </SectionCard>
          )}

          <SectionCard title="Status history" subtitle={events.length ? `${events.length} event${events.length === 1 ? "" : "s"}` : undefined}>
            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
                No account-status history yet. History starts when console account actions are used.
              </div>
            ) : (
              <ol className="relative px-1 py-1">
                <span className="absolute bottom-3 left-[7px] top-3 w-px bg-white/8" aria-hidden />
                {events.map((e, i) => (
                  <li key={i} className="relative flex gap-3 py-2.5">
                    <span className={`relative z-10 mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 rounded-full border-2 border-slate-950 ${ACTION_DOT[tone(e.action)]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[12px] font-medium text-slate-100">{prettyAction(e.action)}</span>
                        {e.status && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">→ {e.status}</span>}
                        <span className="ml-auto text-[10px] text-slate-600">{absolute(e.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        by <span className="font-mono text-slate-500">{maskWho(e.onBehalfOf || e.actor)}</span>
                        {e.actorRole && <> · role <span className="text-slate-400">{e.actorRole}</span></>}
                        {e.requestId && <> · req <span className="font-mono text-slate-600">{shortId(e.requestId)}</span></>}
                      </p>
                      {(e.reason || e.note) && <p className="mt-0.5 truncate text-[11px] text-slate-400">reason: {e.reason || e.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          Suspend / ban / restore are RBAC-gated, require a reason, and are audited server-side (actor, role, request id,
          reason). Identity is masked — no full phone, email, OTP, token, raw metadata, or private content is shown.
          Force-logout and device-revoke are planned (disabled).
        </p>
      </div>
    </ConsolePageShell>
  );
}
