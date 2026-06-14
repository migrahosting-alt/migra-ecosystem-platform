import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Users,
  Activity,
  Server,
  Smartphone,
  AlertTriangle,
  Inbox,
  Scale,
  MessageSquareWarning,
  Eye,
  ShieldOff,
  LogOut,
  ArrowRight,
  Clock,
  Radio,
  Gavel,
  Image as ImageIcon,
  Phone,
  UserX,
  CheckCircle2,
} from "lucide-react";

import type {
  PaleDashboardView,
  SignalView,
  ReleaseRow,
  AuditView,
  UserView,
  QueueView,
} from "../lib/pale-dashboard";

const MUTATION_TIP = "Action wiring requires RBAC + audit log.";

/* ------------------------------------------------------------- primitives */

const TONE_DOT: Record<string, string> = {
  ok: "bg-emerald-400", warn: "bg-amber-400", danger: "bg-rose-400", idle: "bg-slate-500",
};
const TONE_TEXT: Record<string, string> = {
  ok: "text-emerald-300", warn: "text-amber-300", danger: "text-rose-300", idle: "text-slate-400",
};

/** Sparkline path generator (inline mini-trend). */
const sparkPath = (values: ReadonlyArray<number>, w = 96, h = 22) => {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values), range = Math.max(max - min, 1);
  const step = w / (values.length - 1);
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / range) * (h - 4) - 2).toFixed(1)}`).join(" ");
};

const Panel = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-white/10 bg-white/[0.025] shadow-xl shadow-slate-950/30 backdrop-blur ${className}`}>
    {children}
  </section>
);

const PanelHead = ({ icon: Icon, title, hint, accent = "text-slate-400", action }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string; accent?: string; action?: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]"><Icon className={`h-4 w-4 ${accent}`} /></span>
      <div>
        <h2 className="text-[13px] font-semibold text-white">{title}</h2>
        {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
      </div>
    </div>
    {action}
  </div>
);

const DisabledChip = ({ children, tip = MUTATION_TIP }: { children: ReactNode; tip?: string }) => (
  <span title={tip} className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-[10px] font-medium text-slate-500 opacity-70">{children}</span>
);

const DisabledIcon = ({ icon: Icon, tip = MUTATION_TIP }: { icon: React.ComponentType<{ className?: string }>; tip?: string }) => (
  <span title={tip} className="cursor-not-allowed text-slate-600 transition hover:text-slate-500"><Icon className="h-3.5 w-3.5" /></span>
);

/** Honest, designed empty state. */
const EmptyState = ({ icon: Icon, title, body, foot }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string; foot?: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 px-5 py-8 text-center">
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]"><Icon className="h-5 w-5 text-slate-500" /></span>
    <p className="text-[12px] font-medium text-slate-300">{title}</p>
    <p className="max-w-[24rem] text-[11px] leading-relaxed text-slate-500">{body}</p>
    {foot && <p className="text-[10px] uppercase tracking-wider text-slate-600">{foot}</p>}
  </div>
);

const QUEUE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  message: MessageSquareWarning, alert: AlertTriangle, "user-x": UserX, phone: Phone, image: ImageIcon,
};
const ACTION_DOT: Record<"danger" | "ok" | "warn", string> = { danger: "bg-rose-400", ok: "bg-emerald-400", warn: "bg-amber-400" };

/* ----------------------------------------------------------------- body */

/**
 * Presentational body of the Pale Control Center. Pure render from a
 * pre-assembled, pre-masked view model — no data fetching, no auth, no
 * mutations. The page component owns auth + data; this owns layout only.
 */
export const PaleControlCenterBody = ({ view: d, roleLabel }: { view: PaleDashboardView; roleLabel: string }) => {
  const backendTone = d.backend.status === "live" ? "ok" : d.backend.status === "down" ? "warn" : "danger";
  const triage = d.triage;
  const triageEmpty = triage.live && !triage.pending && !triage.reviewing && !triage.escalated;

  return (
    <>
      {/* ── Hero command header ── */}
      <section className="relative -mt-1 overflow-hidden rounded-2xl border border-sky-400/15 bg-gradient-to-br from-sky-500/[0.10] via-violet-500/[0.07] to-fuchsia-500/[0.08] px-5 py-5 sm:px-7 sm:py-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-violet-500/30 to-transparent blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] shadow-lg shadow-sky-950/30">
              <Image src="/brands/products/pale.png" alt="Pale" fill sizes="48px" className="object-contain p-1.5" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Pale Control Center</h1>
              <p className="mt-0.5 text-[12px] text-slate-300/90">Trust, safety, support, and operational control for the Pale app.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold text-sky-200"><Radio className="h-3 w-3" /> {roleLabel} · Read-only</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${backendTone === "ok" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : backendTone === "warn" ? "border-amber-400/25 bg-amber-500/10 text-amber-200" : "border-rose-400/25 bg-rose-500/10 text-rose-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[backendTone]} ${backendTone === "ok" ? "animate-pulse" : ""}`} /> Backend {d.backend.status === "live" ? "operational" : d.backend.status}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300"><Clock className="h-3 w-3 text-slate-500" /> Synced {d.lastSync}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> Production</span>
          </div>
        </div>
      </section>

      {/* ── Operational health strip ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {d.signals.map((s: SignalView) => {
          const path = sparkPath(s.spark);
          return (
            <div key={s.key} className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] px-3.5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{s.label}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[s.tone]}`} />
              </div>
              <p className="mt-1 truncate text-lg font-bold tracking-tight text-white">{s.value}</p>
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <span className={`text-[10px] ${TONE_TEXT[s.tone]}`}>{s.sub}</span>
                {path && (
                  <svg viewBox="0 0 96 22" className={`h-5 w-16 shrink-0 ${TONE_TEXT[s.tone]}`} preserveAspectRatio="none">
                    <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-80" />
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Triage Command Queue (primary, spans 2) */}
        <Panel className="xl:col-span-2">
          <PanelHead icon={ShieldAlert} title="Triage Command Queue" hint="Trust &amp; Safety report pipeline" accent="text-amber-300"
            action={<Link href="/console/pale/reports" className="inline-flex items-center gap-1 rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20">Open triage queue <ArrowRight className="h-3.5 w-3.5" /></Link>} />
          {/* triage stat tiles */}
          <div className="grid grid-cols-2 gap-px bg-white/5 sm:grid-cols-4">
            {[
              { k: "Pending", v: triage.pending, icon: Inbox },
              { k: "Reviewing", v: triage.reviewing, icon: Eye },
              { k: "Escalated", v: triage.escalated, icon: ShieldAlert },
              { k: "Resolved today", v: triage.resolvedToday, icon: CheckCircle2 },
            ].map((t) => {
              const T = t.icon;
              return (
                <div key={t.k} className="bg-slate-950/40 px-4 py-3.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500"><T className="h-3 w-3" /> {t.k}</div>
                  <p className={`mt-1 text-2xl font-bold tracking-tight ${triage.live ? "text-white" : "text-slate-600"}`}>{triage.live ? (t.v ?? 0) : "—"}</p>
                </div>
              );
            })}
          </div>
          {/* queue by type / empty */}
          {triageEmpty || (!triage.live && d.queue.rows.length === 0) ? (
            <EmptyState icon={ShieldCheck} title="No reports waiting." body={triage.live ? "Pale is quiet right now. New reports will appear here for review the moment they arrive." : "Connect the Pale read-only database (PALE_DATABASE_URL) to surface the live report queue here."} foot={triage.live ? "queue clear" : "awaiting data source"} />
          ) : (
            <div className="divide-y divide-white/5 px-2 py-1">
              {d.queue.rows.map((q: QueueView) => {
                const QI = QUEUE_ICONS[q.icon] ?? MessageSquareWarning;
                return (
                  <div key={q.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="flex items-center gap-2.5 text-[12px] text-slate-200"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]"><QI className="h-3.5 w-3.5 text-amber-300/80" /></span>{q.label}</span>
                    <span className="flex items-center gap-3">
                      <span className="rounded-md bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-200">{q.count}</span>
                      <span className="hidden w-16 text-right text-[10px] text-slate-500 sm:block">{q.oldest}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-white/5 px-5 py-2.5">
            <DisabledChip>Review reports</DisabledChip>
            <span className="text-[10px] text-slate-600">Actions enable in Phase 2 (RBAC + audit).</span>
          </div>
        </Panel>

        {/* Release & Security */}
        <Panel>
          <PanelHead icon={Server} title="Release &amp; Security" hint="Client + platform posture" accent="text-violet-300" />
          <div className="divide-y divide-white/5 px-5">
            {d.release.map((r: ReleaseRow) => (
              <div key={r.label} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[11px] text-slate-400">{r.label}</span>
                <span className="flex items-center gap-1.5 text-right">
                  {r.pending && !r.ok ? (
                    <span className="rounded-md border border-amber-400/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">{r.value.includes("approval") ? "Approval required" : "Requires endpoint"}</span>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-200">{r.value}</span>
                  )}
                  {r.ok && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-white/5 px-5 py-2.5"><p className="text-[10px] leading-relaxed text-slate-600">Mobile release, Telnyx, and private-media flags are backend-owned and changed only with explicit approval.</p></div>
        </Panel>

        {/* User Intelligence (spans 2) */}
        <Panel className="xl:col-span-2">
          <PanelHead icon={Users} title="User Intelligence" hint="Most recent accounts · masked" accent="text-sky-300"
            action={<DisabledChip tip="User search wiring in Phase 2">Search…</DisabledChip>} />
          {d.users.live && d.users.rows.length > 0 ? (
            <div className="divide-y divide-white/5">
              {d.users.rows.map((u: UserView, i: number) => (
                <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-sky-500/20 to-violet-500/20 text-[11px] font-semibold text-sky-100">{u.name.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-slate-100">{u.name}</p>
                    <p className="truncate font-mono text-[10px] text-slate-500">{u.phone}</p>
                  </div>
                  <span className={`hidden items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-medium sm:inline-flex ${u.statusTone === "danger" ? "border-rose-400/20 bg-rose-500/10 text-rose-300" : u.statusTone === "warn" ? "border-amber-400/20 bg-amber-500/10 text-amber-300" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"}`}><span className={`h-1 w-1 rounded-full ${TONE_DOT[u.statusTone]}`} />{u.status}</span>
                  <span className="hidden w-20 text-right text-[10px] text-slate-500 md:block">{u.lastActive}</span>
                  <span className="hidden items-center gap-1 text-[10px] text-slate-500 lg:flex"><Smartphone className="h-3 w-3" />{u.devices}</span>
                  <span className="flex items-center gap-1.5 pl-1">
                    <DisabledIcon icon={Eye} tip="User detail coming soon" />
                    <DisabledIcon icon={ShieldOff} />
                    <DisabledIcon icon={LogOut} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Users} title={d.users.live ? "No users yet." : "User intelligence not connected."} body={d.users.live ? "New Pale accounts will appear here with masked identity and status." : "Set the read-only PALE_DATABASE_URL to populate masked user intelligence."} foot={d.users.live ? "no accounts" : "awaiting data source"} />
          )}
          <div className="border-t border-white/5 px-5 py-2.5"><DisabledChip tip="All-users view + actions land in Phase 2">View all users</DisabledChip></div>
        </Panel>

        {/* Support / Appeals / OTP placeholders — designed honest empty states */}
        <div className="grid grid-cols-1 gap-4">
          <Panel>
            <PanelHead icon={Inbox} title="Support" accent="text-rose-300" action={<span className="rounded-md border border-slate-400/20 bg-slate-500/10 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">Phase 3</span>} />
            <EmptyState icon={Inbox} title="No support endpoint connected yet." body="Support ticket ingestion will appear here after Phase 3." foot="coming soon" />
          </Panel>
          <Panel>
            <PanelHead icon={Scale} title="Appeals &amp; Claims" accent="text-blue-300" action={<span className="rounded-md border border-slate-400/20 bg-slate-500/10 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">Phase 3</span>} />
            <EmptyState icon={Gavel} title="No appeals endpoint connected yet." body="Ban / content / ownership appeals will land here once the Appeal model ships." foot="coming soon" />
          </Panel>
          <Panel>
            <PanelHead icon={ShieldCheck} title="OTP Delivery" accent="text-emerald-300" action={<span className="rounded-md border border-amber-400/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">Requires endpoint</span>} />
            <EmptyState icon={ShieldCheck} title="OTP telemetry not wired yet." body="Delivery health (provider, route, latency — masked) will appear here from the Telnyx Verify source in Phase 5." foot="coming soon" />
          </Panel>
        </div>
      </div>

      {/* ── Audit timeline ── */}
      <Panel>
        <PanelHead icon={Activity} title="Audit Timeline" hint="Latest admin &amp; system actions · actors masked" accent="text-fuchsia-300"
          action={<DisabledChip tip="Full audit explorer in Phase 2">Full log</DisabledChip>} />
        {d.audit.live && d.audit.rows.length > 0 ? (
          <ol className="relative px-5 py-3">
            <span className="absolute left-[26px] top-4 bottom-4 w-px bg-white/8" aria-hidden />
            {d.audit.rows.map((a: AuditView, i: number) => (
              <li key={i} className="relative flex gap-3.5 py-2.5">
                <span className={`relative z-10 mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-slate-950 ${ACTION_DOT[a.tone]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[12px] font-medium text-slate-100">{a.action}</span>
                    <span className="font-mono text-[10px] text-slate-500">{a.admin}</span>
                    <span className="ml-auto text-[10px] text-slate-600">{a.time}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400"><span className="font-mono text-slate-500">{a.target}</span> · {a.details}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState icon={Activity} title={d.audit.live ? "No audit activity yet." : "Audit timeline not connected."} body={d.audit.live ? "Every admin and moderation action will stream here with masked actors." : "Connect the read-only PALE_DATABASE_URL to surface the live audit timeline."} foot={d.audit.live ? "quiet" : "awaiting data source"} />
        )}
      </Panel>

      {/* footer */}
      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p className="text-[11px] leading-relaxed text-slate-400">Read-only operations surface. Phones and phone-derived usernames are masked; no OTP codes, tokens, or private media are shown. Mutations require Phase 2 (RBAC + confirmation + audit log).</p>
      </div>
    </>
  );
};
