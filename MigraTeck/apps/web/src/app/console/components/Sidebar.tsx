import Image from "next/image";
import Link from "next/link";
import {
  LayoutDashboard,
  Boxes,
  Server,
  Globe,
  Mail,
  Phone,
  FileText,
  Megaphone,
  Workflow,
  Receipt,
  Users,
  LifeBuoy,
  BarChart3,
  Shield,
  UsersRound,
  Settings,
  ChevronLeft,
  Activity,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: ReadonlyArray<NavItem> = [
  { label: "Overview", href: "/console", icon: LayoutDashboard },
  { label: "Ecosystem", href: "/console/ecosystem", icon: Boxes },
  { label: "Hosting", href: "/console/hosting", icon: Server },
  { label: "Domains", href: "/console/domains", icon: Globe },
  { label: "Email", href: "/console/email", icon: Mail },
  { label: "Voice", href: "/console/voice", icon: Phone },
  { label: "Intake", href: "/console/intake", icon: FileText },
  { label: "Marketing", href: "/console/marketing", icon: Megaphone },
  { label: "Automation", href: "/console/automation", icon: Workflow },
  { label: "Billing", href: "/console/billing", icon: Receipt },
  { label: "Clients", href: "/console/clients", icon: Users },
  { label: "Support", href: "/console/support", icon: LifeBuoy },
  { label: "Activity", href: "/console/activity", icon: Activity },
  { label: "Analytics", href: "/console/analytics", icon: BarChart3 },
  { label: "Security", href: "/console/security", icon: Shield },
  { label: "Team", href: "/console/team", icon: UsersRound },
  { label: "Settings", href: "/console/settings", icon: Settings },
];

export const Sidebar = ({ activePath }: { activePath: string }) => {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-slate-950/95 backdrop-blur lg:flex">
      <div className="flex items-center justify-between px-5 py-5">
        <Link href="/console" className="flex items-center gap-3">
          <span className="relative inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-lg shadow-fuchsia-950/20">
            <Image
              src="/brands/products/migrapanel-mark.png"
              alt="MigraPanel"
              fill
              sizes="44px"
              className="object-contain p-0.5"
            />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-white">MigraPanel</span>
            <span className="block text-[10px] uppercase tracking-[0.24em] text-slate-500">Control Center</span>
          </span>
        </Link>
        <button
          type="button"
          aria-label="Collapse sidebar"
          className="rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5 text-sm">
          {NAV.map((item) => {
            const active = activePath === item.href || (item.href !== "/console" && activePath.startsWith(item.href));
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={[
                    "group flex items-center gap-3 rounded-lg px-3 py-2 transition",
                    active
                      ? "bg-gradient-to-r from-fuchsia-500/15 via-purple-500/10 to-transparent text-white shadow-[inset_0_0_0_1px_rgba(217,70,239,0.25)]"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                  ].join(" ")}
                >
                  <Icon
                    className={[
                      "h-4 w-4 shrink-0 transition",
                      active ? "text-fuchsia-300" : "text-slate-500 group-hover:text-slate-300",
                    ].join(" ")}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mx-3 mb-3 rounded-2xl border border-white/10 bg-gradient-to-br from-purple-600/10 via-fuchsia-600/10 to-pink-600/10 p-4 text-sm">
        <div className="mb-1 flex items-center gap-2">
          <span className="relative inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/10">
            <Image
              src="/brands/products/migrapanel-mark.png"
              alt="MigraPanel"
              fill
              sizes="24px"
              className="object-contain p-0.5"
            />
          </span>
          <span className="text-xs font-semibold text-white">MigraPanel Enterprise</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Enterprise Plan
          <br />
          Unlimited Everything
        </p>
        <Link
          href="/console/settings/plan"
          className="mt-3 inline-flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-fuchsia-400/40 hover:bg-white/10"
        >
          View Plan Details
          <span aria-hidden>›</span>
        </Link>
      </div>

      <div className="mx-3 mb-4 flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          All Systems Operational
        </span>
        <button
          type="button"
          aria-label="Toggle theme"
          className="rounded p-1 hover:bg-white/10 hover:text-white"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        </button>
      </div>

      <p className="px-5 pb-4 text-[10px] text-slate-600">
        © 2026 MigraTeck
        <br />
        MigraPanel Control Center
      </p>
    </aside>
  );
};
