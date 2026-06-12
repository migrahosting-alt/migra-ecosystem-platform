import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Users,
  Activity,
  ShieldAlert,
  Ticket,
  Scale,
  ShieldCheck,
  MessageSquare,
  AlertTriangle,
  UserX,
  Phone,
  Image as ImageIcon,
  Search,
  Eye,
  ShieldOff,
  LogOut,
  ChevronDown,
  Download,
  Check,
  Lock,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

import { getSession } from "../lib/auth";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { getPaleDashboardView } from "../lib/pale-dashboard";
import type { KpiView, ReleaseRow } from "../lib/pale-dashboard";
import { getPaleRole, hasPaleReadAccess, paleRoleLabel, PALE_READ_ROLES } from "../lib/pale-rbac";

export const dynamic = "force-dynamic";

const MUTATION_TIP = "Action wiring requires RBAC + audit log.";

/* ---------------------------------------------------------------- KPI card */

const KPI_VARIANTS: Record<KpiView["variant"], { iconBg: string; spark: string; ring: string }> = {
  violet: { iconBg: "from-violet-500 to-purple-500", spark: "stroke-violet-400 text-violet-400", ring: "from-violet-500/40" },
  fuchsia: { iconBg: "from-fuchsia-500 to-pink-500", spark: "stroke-fuchsia-400 text-fuchsia-400", ring: "from-fuchsia-500/40" },
  amber: { iconBg: "from-amber-500 to-orange-500", spark: "stroke-amber-400 text-amber-400", ring: "from-amber-500/40" },
  rose: { iconBg: "from-rose-500 to-red-500", spark: "stroke-rose-400 text-rose-400", ring: "from-rose-500/40" },
  blue: { iconBg: "from-blue-500 to-cyan-500", spark: "stroke-blue-400 text-blue-400", ring: "from-blue-500/40" },
  emerald: { iconBg: "from-emerald-500 to-teal-500", spark: "stroke-emerald-400 text-emerald-400", ring: "from-emerald-500/40" },
};

const KPI_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  users: Users, active: Activity, reports: ShieldAlert, tickets: Ticket, appeals: Scale, otp: ShieldCheck,
};

const sparkPath = (values: ReadonlyArray<number>, width = 240, height = 40) => {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(max - min, 1);
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, height - ((v - min) / range) * (height - 6) - 3] as const);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return { line, fill: `M0,${height} ${line.replace("M", "L")} L${width},${height} Z` };
};

const KpiCard = ({ kpi }: { kpi: KpiView }) => {
  const v = KPI_VARIANTS[kpi.variant];
  const Icon = KPI_ICONS[kpi.key] ?? Activity;
  const spark = kpi.notConfigured ? null : sparkPath(kpi.spark);
  const DeltaIcon = kpi.deltaDir === "up" ? TrendingUp : kpi.deltaDir === "down" ? TrendingDown : Minus;
  const deltaColor = kpi.deltaDir === "down" ? "text-rose-400" : kpi.deltaDir === "up" ? "text-emerald-400" : "text-slate-500";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.05]">
      <div className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${v.ring} via-transparent to-transparent blur-2xl`} />
      <div className="relative flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${v.iconBg} shadow-lg shadow-slate-950/30`}>
          <Icon className="h-5 w-5 text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-400">{kpi.label}</p>
          {kpi.notConfigured ? (
            <p className="mt-1 text-sm font-semibold text-slate-500">{kpi.value}</p>
          ) : (
            <p className="mt-0.5 text-2xl font-bold tracking-tight text-white">{kpi.value}</p>
          )}
        </div>
      </div>
      {kpi.notConfigured ? (
        <div className="relative mt-2"><StatusTag kind="endpoint" /></div>
      ) : (
        <>
          <div className="relative mt-2 flex items-center gap-1.5 text-[11px]">
            <DeltaIcon className={`h-3 w-3 ${deltaColor}`} />
            <span className={`font-semibold ${deltaColor}`}>{kpi.deltaPct == null ? "—" : `${kpi.deltaPct.toFixed(1)}%`}</span>
            <span className="text-slate-500">{kpi.period}</span>
          </div>
          {spark && (
            <svg viewBox="0 0 240 40" className={`relative mt-2 h-9 w-full ${v.spark}`} preserveAspectRatio="none">
              <path d={spark.fill} className="fill-current opacity-15" stroke="none" />
              <path d={spark.line} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------- primitives */

const BADGE: Record<string, string> = {
  Active: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  Suspended: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  Banned: "border-rose-400/20 bg-rose-500/10 text-rose-300",
};
const Badge = ({ label }: { label: string }) => (
  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${BADGE[label] ?? "border-slate-400/20 bg-slate-500/10 text-slate-300"}`}>{label}</span>
);

const TAG: Record<string, { cls: string; text: string }> = {
  live: { cls: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300", text: "Live" },
  soon: { cls: "border-slate-400/20 bg-slate-500/10 text-slate-400", text: "Coming soon" },
  endpoint: { cls: "border-amber-400/20 bg-amber-500/10 text-amber-300", text: "Requires endpoint" },
  restricted: { cls: "border-sky-400/20 bg-sky-500/10 text-sky-300", text: "Restricted" },
};
const StatusTag = ({ kind, label }: { kind: keyof typeof TAG; label?: string }) => {
  const t = TAG[kind]!;
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${t.cls}`}>{label ?? t.text}</span>;
};

const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <th className={`px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500 ${right ? "text-right" : "text-left"}`}>{children}</th>
);
const Td = ({ children, right, className = "" }: { children: ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-2 py-2.5 align-middle text-[12px] ${right ? "text-right" : "text-left"} ${className}`}>{children}</td>
);

/** Disabled mutation/nav control — visibly inert with an explanatory tooltip. */
const DisabledBtn = ({ children, tip = MUTATION_TIP }: { children: ReactNode; tip?: string }) => (
  <span title={tip} className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1 text-[11px] font-medium text-slate-500 opacity-70">
    {children}
  </span>
);
const DisabledIcon = ({ icon: Icon, tip = MUTATION_TIP }: { icon: React.ComponentType<{ className?: string }>; tip?: string }) => (
  <span title={tip} className="cursor-not-allowed text-slate-600 opacity-60"><Icon className="h-3.5 w-3.5" /></span>
);
const FooterDisabled = ({ label }: { label: string }) => (
  <div title="Detail view coming soon" className="mt-1 flex cursor-not-allowed items-center justify-center gap-1.5 border-t border-white/5 pt-3 text-[11px] font-medium text-slate-600">
    {label} · Coming soon
  </div>
);
const EmptyPanel = ({ text }: { text: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center">
    <Lock className="h-4 w-4 text-slate-600" />
    <p className="text-[11px] text-slate-500">{text}</p>
  </div>
);

const QUEUE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  message: MessageSquare, alert: AlertTriangle, "user-x": UserX, phone: Phone, image: ImageIcon,
};
const ACTION_TONE: Record<"danger" | "ok" | "warn", string> = { danger: "bg-rose-400", ok: "bg-emerald-400", warn: "bg-amber-400" };

/* ---------------------------------------------------------------- 403 view */

const AccessDenied = ({ role }: { role: string | null }) => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
    <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10">
      <Lock className="h-6 w-6 text-rose-300" />
    </span>
    <h1 className="text-xl font-semibold text-white">Access denied</h1>
    <p className="max-w-sm text-sm text-slate-400">
      The Pale Control Center requires an Owner, Admin, Trust &amp; Safety Manager, or Read-only
      Auditor role.{role ? ` Your role (${role}) is not permitted.` : " Your account has no Pale role."}
    </p>
    <Link href="/console" className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-200 transition hover:bg-white/10">Back to Overview</Link>
  </div>
);

/* --------------------------------------------------------------------- page */

export default async function PaleControlCenter() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const role = getPaleRole(session);
  if (!hasPaleReadAccess(role)) {
    // Authenticated but unauthorized → 403 (no redirect to login).
    return (
      <ConsolePageShell session={session} activePath="/console/pale" title="Pale Control Center" subtitle="Restricted module">
        <AccessDenied role={role} />
      </ConsolePageShell>
    );
  }

  const d = await getPaleDashboardView();
  const roleLabel = paleRoleLabel(role);

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/pale"
      title="Pale Control Center"
      subtitle="Trust, safety, support, and operational control for the Pale app."
      actions={
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-300" title={`Read-only access · ${PALE_READ_ROLES.length} roles permitted`}>
            <ShieldCheck className="h-3 w-3" /> {roleLabel} · Read-only
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-sky-500 to-violet-500 text-[8px] font-bold text-white">P</span>
            Pale App <ChevronDown className="h-3 w-3 text-slate-400" />
          </span>
          <DisabledBtn tip="Export wiring coming soon"><Download className="h-3 w-3" /> Export Report</DisabledBtn>
        </>
      }
    >
      {/* Breadcrumb */}
      <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Link href="/console/ecosystem" className="hover:text-slate-300">Apps</Link>
        <span>/</span>
        <span className="text-slate-300">Pale</span>
      </div>

      {!d.dbConfigured && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-500/[0.06] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            Pale DB not configured — set <code className="rounded bg-black/30 px-1">PALE_DATABASE_URL</code> (read-only role)
            on the console host to light up live data. Until then every panel shows an honest
            &quot;Not configured&quot; state; no numbers are fabricated.
          </p>
        </div>
      )}

      {/* 6 KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {d.kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
      </div>

      {/* Row: Trust & Safety / Support Tickets / User Control */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* 1. Trust & Safety Queue (live aggregation) */}
        <SectionCard
          title="1. Trust & Safety Queue"
          actions={<><StatusTag kind={d.queue.live ? "live" : "endpoint"} /><DisabledBtn>Review Reports</DisabledBtn></>}
        >
          {d.queue.live && d.queue.rows.length > 0 ? (
            <table className="w-full border-collapse">
              <thead><tr><Th>Type</Th><Th>Count</Th><Th right>Oldest</Th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.queue.rows.map((r) => {
                  const QIcon = QUEUE_ICONS[r.icon] ?? MessageSquare;
                  return (
                    <tr key={r.label}>
                      <Td><span className="flex items-center gap-2 text-slate-200"><QIcon className="h-3.5 w-3.5 text-slate-500" />{r.label}</span></Td>
                      <Td className="font-mono text-slate-300">{r.count}</Td>
                      <Td right className="text-slate-500">{r.oldest}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyPanel text={d.queue.live ? "No open reports in the queue." : "Pale DB not configured — no live report queue."} />
          )}
          <FooterDisabled label="Open Queue" />
        </SectionCard>

        {/* 2. Support Tickets (no model yet) */}
        <SectionCard title="2. Support Tickets" actions={<><StatusTag kind="soon" /><DisabledBtn>Create Case</DisabledBtn></>}>
          <EmptyPanel text="No live endpoint connected yet. Tickets require a SupportTicket model + API (Phase 3)." />
          <FooterDisabled label="View All Tickets" />
        </SectionCard>

        {/* 3. User Control (live, read-only, masked) */}
        <SectionCard
          title="3. User Control"
          actions={<><StatusTag kind={d.users.live ? "live" : "endpoint"} /><span className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-500"><Search className="h-3 w-3" /> Search…</span></>}
        >
          {d.users.live && d.users.rows.length > 0 ? (
            <table className="w-full border-collapse">
              <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Status</Th><Th>Last Active</Th><Th right>Action</Th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.users.rows.map((u, i) => (
                  <tr key={i}>
                    <Td className="text-slate-200">{u.name}</Td>
                    <Td className="font-mono text-slate-400">{u.phone}</Td>
                    <Td><Badge label={u.status} /></Td>
                    <Td className="text-slate-500">{u.lastActive}</Td>
                    <Td right>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <DisabledIcon icon={Eye} tip="User detail coming soon" />
                        <DisabledIcon icon={ShieldOff} />
                        <DisabledIcon icon={LogOut} />
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyPanel text={d.users.live ? "No users found." : "Pale DB not configured — no live user list."} />
          )}
          <FooterDisabled label="View All Users" />
        </SectionCard>
      </div>

      {/* Row: Appeals / OTP Delivery / Release & Security */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* 4. Appeals & Claims (no model yet) */}
        <SectionCard title="4. Appeals & Claims" actions={<StatusTag kind="soon" />}>
          <EmptyPanel text="No live endpoint connected yet. Appeals require an Appeal model + API (Phase 3)." />
          <FooterDisabled label="Review Appeals" />
        </SectionCard>

        {/* 5. OTP Delivery (no local provider data) */}
        <SectionCard title="5. OTP Delivery" actions={<StatusTag kind="endpoint" />}>
          <EmptyPanel text="No live endpoint connected yet. Delivery telemetry requires the Telnyx Verify/OTP-events source (Phase 5)." />
          <FooterDisabled label="View Delivery Dashboard" />
        </SectionCard>

        {/* 6. Release & Security Status */}
        <SectionCard title="6. Release & Security Status">
          <div className="divide-y divide-white/5">
            {d.release.map((r: ReleaseRow) => (
              <div key={r.label} className="flex items-center justify-between gap-3 py-2">
                <span className="text-[12px] text-slate-400">{r.label}</span>
                <span className="flex items-center gap-2">
                  {r.pending ? <StatusTag kind="endpoint" /> : <span className="text-[12px] font-medium text-slate-200">{r.value}</span>}
                  {r.badge && <StatusTag kind="live" label={r.badge.text} />}
                  {r.ok && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </span>
              </div>
            ))}
          </div>
          <FooterDisabled label="View Release Center" />
        </SectionCard>
      </div>

      {/* 7. Audit Log (live, read-only) */}
      <SectionCard
        title={<>7. Audit Log <span className="font-normal text-slate-500">(Latest Activity)</span></>}
        actions={<><StatusTag kind={d.audit.live ? "live" : "endpoint"} /><DisabledBtn>View Full Audit Log</DisabledBtn></>}
      >
        {d.audit.live && d.audit.rows.length > 0 ? (
          <table className="w-full border-collapse">
            <thead><tr><Th>Time</Th><Th>Admin</Th><Th>Action</Th><Th>Target</Th><Th>Details</Th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.audit.rows.map((a, i) => (
                <tr key={i}>
                  <Td className="text-slate-500">{a.time}</Td>
                  <Td className="font-mono text-slate-300">{a.admin}</Td>
                  <Td><span className="flex items-center gap-2 text-slate-200"><span className={`h-1.5 w-1.5 rounded-full ${ACTION_TONE[a.tone]}`} />{a.action}</span></Td>
                  <Td className="font-mono text-slate-300">{a.target}</Td>
                  <Td className="text-slate-500">{a.details}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyPanel text={d.audit.live ? "No audit activity yet." : "Pale DB not configured — no live audit log."} />
        )}
      </SectionCard>

      {/* Footer note */}
      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          Phase 1 — read-only. Live panels read the Pale database through a read-only connection;
          phone numbers are masked and no OTP codes, tokens, or private media are ever shown.
          All actions are disabled pending Phase 2 (mutations require RBAC + confirmation + audit log).
        </p>
      </div>
    </ConsolePageShell>
  );
}
