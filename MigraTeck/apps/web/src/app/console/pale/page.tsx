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
  Ban,
  Phone,
  Image as ImageIcon,
  Search,
  Eye,
  ShieldOff,
  LogOut,
  ChevronDown,
  Download,
  ArrowRight,
  Check,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

import { getSession } from "../lib/auth";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { getPaleDashboard } from "../lib/pale-dashboard";
import type {
  PaleKpi,
  QueueRow,
  AuditRow,
  ReleaseRow,
} from "../lib/pale-dashboard";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------- KPI card */

const KPI_VARIANTS: Record<PaleKpi["variant"], { iconBg: string; spark: string; ring: string }> = {
  violet: { iconBg: "from-violet-500 to-purple-500", spark: "stroke-violet-400 text-violet-400", ring: "from-violet-500/40" },
  fuchsia: { iconBg: "from-fuchsia-500 to-pink-500", spark: "stroke-fuchsia-400 text-fuchsia-400", ring: "from-fuchsia-500/40" },
  amber: { iconBg: "from-amber-500 to-orange-500", spark: "stroke-amber-400 text-amber-400", ring: "from-amber-500/40" },
  rose: { iconBg: "from-rose-500 to-red-500", spark: "stroke-rose-400 text-rose-400", ring: "from-rose-500/40" },
  blue: { iconBg: "from-blue-500 to-cyan-500", spark: "stroke-blue-400 text-blue-400", ring: "from-blue-500/40" },
  emerald: { iconBg: "from-emerald-500 to-teal-500", spark: "stroke-emerald-400 text-emerald-400", ring: "from-emerald-500/40" },
};

const KPI_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  users: Users,
  active: Activity,
  reports: ShieldAlert,
  tickets: Ticket,
  appeals: Scale,
  otp: ShieldCheck,
};

const sparkPath = (values: ReadonlyArray<number>, width = 240, height = 40) => {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(max - min, 1);
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, height - ((v - min) / range) * (height - 6) - 3] as const);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const fill = `M0,${height} ${line.replace("M", "L")} L${width},${height} Z`;
  return { line, fill };
};

const KpiCard = ({ kpi }: { kpi: PaleKpi }) => {
  const v = KPI_VARIANTS[kpi.variant];
  const Icon = KPI_ICONS[kpi.key] ?? Activity;
  const spark = sparkPath(kpi.spark);
  const DeltaIcon = kpi.deltaDir === "up" ? TrendingUp : kpi.deltaDir === "down" ? TrendingDown : Minus;
  const deltaColor = kpi.deltaDir === "down" ? "text-rose-400" : "text-emerald-400";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.05]">
      <div className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${v.ring} via-transparent to-transparent blur-2xl`} />
      <div className="relative flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${v.iconBg} shadow-lg shadow-slate-950/30`}>
          <Icon className="h-5 w-5 text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-400">{kpi.label}</p>
          <p className="mt-0.5 text-2xl font-bold tracking-tight text-white">{kpi.value}</p>
        </div>
      </div>
      <div className="relative mt-2 flex items-center gap-1.5 text-[11px]">
        <DeltaIcon className={`h-3 w-3 ${deltaColor}`} />
        <span className={`font-semibold ${deltaColor}`}>{kpi.deltaPct.toFixed(1)}%</span>
        <span className="text-slate-500">{kpi.period}</span>
      </div>
      {spark && (
        <svg viewBox="0 0 240 40" className={`relative mt-2 h-9 w-full ${v.spark}`} preserveAspectRatio="none">
          <path d={spark.fill} className="fill-current opacity-15" stroke="none" />
          <path d={spark.line} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
};

/* ------------------------------------------------------------- primitives */

const BADGE: Record<string, string> = {
  High: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  Medium: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  Reviewing: "border-sky-400/20 bg-sky-500/10 text-sky-300",
  Open: "border-violet-400/20 bg-violet-500/10 text-violet-300",
  Pending: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  Active: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  Suspended: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  "Under Review": "border-sky-400/20 bg-sky-500/10 text-sky-300",
  "Pending Info": "border-amber-400/20 bg-amber-500/10 text-amber-300",
  Latest: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  Internal: "border-sky-400/20 bg-sky-500/10 text-sky-300",
};

const Badge = ({ label }: { label: string }) => (
  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${BADGE[label] ?? "border-slate-400/20 bg-slate-500/10 text-slate-300"}`}>
    {label}
  </span>
);

const HealthPill = ({ label }: { label: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
    {label}
  </span>
);

const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <th className={`px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500 ${right ? "text-right" : "text-left"}`}>{children}</th>
);
const Td = ({ children, right, className = "" }: { children: ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-2 py-2.5 align-middle text-[12px] ${right ? "text-right" : "text-left"} ${className}`}>{children}</td>
);

const SectionLink = ({ href, label }: { href: string; label: string }) => (
  <Link href={href} className="mt-1 flex items-center justify-center gap-1.5 border-t border-white/5 pt-3 text-[11px] font-medium text-fuchsia-300 transition hover:text-fuchsia-200">
    {label} <ArrowRight className="h-3.5 w-3.5" />
  </Link>
);

const HeaderBtn = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:border-fuchsia-400/40 hover:bg-white/10">
    {children}
  </Link>
);

const QUEUE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  message: MessageSquare,
  alert: AlertTriangle,
  "user-x": UserX,
  ban: Ban,
  phone: Phone,
  image: ImageIcon,
};

const ACTION_TONE: Record<AuditRow["actionTone"], string> = {
  danger: "bg-rose-400",
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
};

/* --------------------------------------------------------------------- page */

export default async function PaleControlCenter() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const d = await getPaleDashboard();

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/pale"
      title="Pale Control Center"
      subtitle="Trust, safety, support, and operational control for the Pale app."
      actions={
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-sky-500 to-violet-500 text-[8px] font-bold text-white">P</span>
            Pale App <ChevronDown className="h-3 w-3 text-slate-400" />
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200">
            <Download className="h-3 w-3 text-slate-400" /> Export Report
          </span>
        </>
      }
    >
      {/* Breadcrumb */}
      <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Link href="/console/ecosystem" className="hover:text-slate-300">Apps</Link>
        <span>/</span>
        <span className="text-slate-300">Pale</span>
      </div>

      {/* 6 KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {d.kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
      </div>

      {/* Row: Trust & Safety / Support Tickets / User Control */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* 1. Trust & Safety Queue */}
        <SectionCard
          title="1. Trust & Safety Queue"
          actions={<HeaderBtn href="/console/pale/reports">Review Reports</HeaderBtn>}
        >
          <table className="w-full border-collapse">
            <thead><tr><Th>Type</Th><Th>Count</Th><Th>Priority</Th><Th right>Oldest</Th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.queue.map((r: QueueRow) => {
                const QIcon = QUEUE_ICONS[r.icon] ?? MessageSquare;
                return (
                  <tr key={r.type}>
                    <Td><span className="flex items-center gap-2 text-slate-200"><QIcon className="h-3.5 w-3.5 text-slate-500" />{r.type}</span></Td>
                    <Td className="font-mono text-slate-300">{r.count}</Td>
                    <Td><Badge label={r.priority} /></Td>
                    <Td right className="text-slate-500">{r.oldest}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <SectionLink href="/console/pale/reports" label="Open Queue" />
        </SectionCard>

        {/* 2. Support Tickets */}
        <SectionCard
          title="2. Support Tickets"
          actions={<HeaderBtn href="/console/pale/tickets">Create Case</HeaderBtn>}
        >
          <table className="w-full border-collapse">
            <thead><tr><Th>Ticket</Th><Th>User</Th><Th>Status</Th><Th right>Updated</Th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.tickets.map((t) => (
                <tr key={t.subject}>
                  <Td className="text-slate-200">{t.subject}</Td>
                  <Td className="font-mono text-slate-400">{t.user}</Td>
                  <Td><Badge label={t.status} /></Td>
                  <Td right className="text-slate-500">{t.updated}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <SectionLink href="/console/pale/tickets" label="View All Tickets" />
        </SectionCard>

        {/* 3. User Control */}
        <SectionCard
          title="3. User Control"
          actions={
            <span className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-500">
              <Search className="h-3 w-3" /> Search by name or phone...
            </span>
          }
        >
          <table className="w-full border-collapse">
            <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Status</Th><Th>Last Active</Th><Th right>Action</Th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.users.map((u) => (
                <tr key={u.name}>
                  <Td className="text-slate-200">{u.name}</Td>
                  <Td className="font-mono text-slate-400">{u.phone}</Td>
                  <Td><Badge label={u.status} /></Td>
                  <Td className="text-slate-500">{u.lastActive}</Td>
                  <Td right>
                    <span className="inline-flex items-center justify-end gap-1.5 text-slate-500">
                      <Eye className="h-3.5 w-3.5 transition hover:text-sky-300" />
                      <ShieldOff className="h-3.5 w-3.5 transition hover:text-rose-300" />
                      <LogOut className="h-3.5 w-3.5 transition hover:text-amber-300" />
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <SectionLink href="/console/pale/users" label="View All Users" />
        </SectionCard>
      </div>

      {/* Row: Appeals / OTP Delivery / Release & Security */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* 4. Appeals & Claims */}
        <SectionCard
          title="4. Appeals & Claims"
          actions={<HeaderBtn href="/console/pale/appeals">View All</HeaderBtn>}
        >
          <table className="w-full border-collapse">
            <thead><tr><Th>Type</Th><Th>User</Th><Th>Status</Th><Th right>Updated</Th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.appeals.map((a) => (
                <tr key={a.type}>
                  <Td className="text-slate-200">{a.type}</Td>
                  <Td className="font-mono text-slate-400">{a.user}</Td>
                  <Td><Badge label={a.status} /></Td>
                  <Td right className="text-slate-500">{a.updated}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <SectionLink href="/console/pale/appeals" label="Review Appeals" />
        </SectionCard>

        {/* 5. OTP Delivery */}
        <SectionCard title="5. OTP Delivery">
          <table className="w-full border-collapse">
            <thead><tr><Th>Route</Th><Th>Region</Th><Th>Success Rate</Th><Th>Latency</Th><Th right>Status</Th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.otpRoutes.map((o) => (
                <tr key={o.route}>
                  <Td className="text-slate-200">{o.route}</Td>
                  <Td className="text-slate-400">{o.region}</Td>
                  <Td className="font-mono text-slate-300">{o.successRate}</Td>
                  <Td className="font-mono text-slate-400">{o.latency}</Td>
                  <Td right><HealthPill label={o.status} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
          <SectionLink href="/console/pale/otp" label="View Delivery Dashboard" />
        </SectionCard>

        {/* 6. Release & Security Status */}
        <SectionCard title="6. Release & Security Status">
          <div className="divide-y divide-white/5">
            {d.release.map((r: ReleaseRow) => (
              <div key={r.label} className="flex items-center justify-between gap-3 py-2">
                <span className="text-[12px] text-slate-400">{r.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-slate-200">{r.value}</span>
                  {r.badge && <Badge label={r.badge.text} />}
                  {r.ok && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </span>
              </div>
            ))}
          </div>
          <SectionLink href="/console/pale/releases" label="View Release Center" />
        </SectionCard>
      </div>

      {/* 7. Audit Log */}
      <SectionCard
        title={<>7. Audit Log <span className="font-normal text-slate-500">(Latest Activity)</span></>}
        actions={<HeaderBtn href="/console/pale/audit-logs">View Full Audit Log</HeaderBtn>}
      >
        <table className="w-full border-collapse">
          <thead><tr><Th>Time</Th><Th>Admin</Th><Th>Action</Th><Th>Target</Th><Th>Details</Th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {d.audit.map((a, i) => (
              <tr key={i}>
                <Td className="text-slate-500">{a.time}</Td>
                <Td className="font-mono text-slate-300">{a.admin}</Td>
                <Td>
                  <span className="flex items-center gap-2 text-slate-200">
                    <span className={`h-1.5 w-1.5 rounded-full ${ACTION_TONE[a.actionTone]}`} />
                    {a.action}
                  </span>
                </Td>
                <Td className="text-slate-300">{a.target}</Td>
                <Td className="text-slate-500">{a.details}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </ConsolePageShell>
  );
}
