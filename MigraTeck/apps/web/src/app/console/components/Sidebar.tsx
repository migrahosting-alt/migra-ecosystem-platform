import Image from "next/image";
import Link from "next/link";
import {
  LayoutDashboard,
  Boxes,
  HardDrive,
  Server,
  Globe,
  Mail,
  Inbox,
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
  Activity,
  BookOpen,
  Sparkles,
  Bell,
} from "lucide-react";

import { SidebarChrome } from "./SidebarChrome";
import { getReleaseInfo } from "../lib/release";

type NavItem = {
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  logoSrc?: string;
};

const NAV: ReadonlyArray<NavItem> = [
  { label: "Overview", href: "/console", icon: LayoutDashboard },
  { label: "Ecosystem", href: "/console/ecosystem", icon: Boxes },
  { label: "Infrastructure", href: "/console/infrastructure", icon: HardDrive },
  { label: "Hosting", href: "/console/hosting", icon: Server },
  { label: "Domains", href: "/console/domains", icon: Globe },
  { label: "Email", href: "/console/email", icon: Mail },
  { label: "Mail", href: "/console/mail", icon: Inbox },
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
  { label: "MigraGuard", href: "/console/migraguard", icon: Shield },
  { label: "Team", href: "/console/team", icon: UsersRound },
  { label: "Pale", href: "/console/pale", logoSrc: "/brands/products/pale.png" },
  { label: "Settings", href: "/console/settings", icon: Settings },
];

export const Sidebar = ({ activePath }: { activePath: string }) => {
  const supportActive = activePath.startsWith("/console/support");
  const supportSubnav = [
    { label: "Abigail Chat", href: "/console/support" },
    { label: "Tickets", href: "/console/support/new" },
    { label: "Knowledge Base", href: "/console/support?panel=knowledge" },
    { label: "Announcements", href: "/console/support?panel=announcements" },
  ];

  const release = getReleaseInfo();

  return (
    <SidebarChrome
      header={
        <Link href="/console" className="flex min-w-0 items-center gap-3">
          <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-lg shadow-fuchsia-950/20">
            <Image
              src="/brands/products/migrapanel-mark.png"
              alt="MigraPanel"
              fill
              sizes="44px"
              className="object-contain p-0.5"
            />
          </span>
          <span className="min-w-0 group-data-[collapsed=true]/sidebar:hidden">
            <span className="block text-base font-semibold text-white">MigraPanel</span>
            <span className="block text-[10px] uppercase tracking-[0.24em] text-slate-500">Control Center</span>
          </span>
        </Link>
      }
      footer={
        <>
        {supportActive ? (
          <div className="mx-3 mb-3 rounded-2xl border border-fuchsia-400/20 bg-[linear-gradient(135deg,rgba(98,49,191,0.28),rgba(217,70,239,0.18))] p-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="relative inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/10">
                <Image
                  src="/brands/products/abigail-chat-logo.png"
                  alt="Abigail"
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              </span>
              <div>
                <p className="text-base font-semibold text-white">Abigail AI Assistant</p>
                <p className="text-[11px] text-fuchsia-100/70">Your 24/7 support co-pilot</p>
              </div>
            </div>
            <Link
              href="/console/support"
              prefetch
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
            >
              Open Abigail
            </Link>
          </div>
        ) : (
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
            {/* REMOVED (Phase 0): "Enterprise Plan / Unlimited Everything" was an
                unsourced marketing claim inside an admin tool, and "View Plan
                Details" linked to /console/settings/plan, a route that does not
                exist — a guaranteed 404. */}
            <Link
              href="/console/billing"
              prefetch
              className="mt-3 inline-flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-fuchsia-400/40 hover:bg-white/10"
            >
              Billing &amp; plan
              <span aria-hidden>›</span>
            </Link>
          </div>
        )}

        {/* REMOVED (Phase 0): a hard-coded "All Systems Operational" strip with a
            pulsing green dot. It was static JSX fed by nothing and stayed green
            through a four-day database outage. Real estate status is shown on the
            Universe page, derived from live probes with their observation age; a
            sidebar badge that is only accurate on one page would be worse than
            none. The adjacent "Toggle theme" button was removed with it: it had no
            onClick and the console has no light theme (zero `dark:` variants). */}

        <p className="px-5 pb-4 text-[10px] text-slate-600">
          © 2026 MigraTeck
          <br />
          MigraPanel Control Center
          {/* Release provenance. This session is the reason it is here: production
              was serving a previous day's release while local work looked done,
              and the only way to tell was to fingerprint the build by hand on the
              server. An operator should always know which code they are looking
              at. Values are read from the running process, not injected at build
              time, so they cannot drift from what is actually deployed. */}
          {release.release ? (
            <>
              <br />
              <span className="text-slate-700">Release {release.release}</span>
            </>
          ) : null}
          {release.build ? (
            <>
              <br />
              <span className="text-slate-700">Build {release.build}</span>
            </>
          ) : null}
        </p>
        </>
      }
    >
        <ul className="space-y-0.5 text-sm">
          {NAV.map((item) => {
            const active = activePath === item.href || (item.href !== "/console" && activePath.startsWith(item.href));
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch
                  className={[
                    "group flex items-center gap-3 rounded-lg px-3 py-2 transition",
                    active
                      ? "bg-gradient-to-r from-fuchsia-500/15 via-purple-500/10 to-transparent text-white shadow-[inset_0_0_0_1px_rgba(217,70,239,0.25)]"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                  ].join(" ")}
                >
                  {item.logoSrc ? (
                    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded">
                      <Image src={item.logoSrc} alt="" fill sizes="16px" className="object-contain" />
                    </span>
                  ) : Icon ? (
                    <Icon
                      className={[
                        "h-4 w-4 shrink-0 transition",
                        active ? "text-fuchsia-300" : "text-slate-500 group-hover:text-slate-300",
                      ].join(" ")}
                    />
                  ) : null}
                  <span className="truncate group-data-[collapsed=true]/sidebar:hidden">{item.label}</span>
                </Link>
                {supportActive && item.href === "/console/support" ? (
                  <div className="mt-2 space-y-1 rounded-2xl border border-fuchsia-500/15 bg-[linear-gradient(180deg,rgba(79,30,127,0.16),rgba(17,24,39,0.12))] p-2">
                    {supportSubnav.map((sub) => {
                      const active = activePath === "/console/support" && sub.href === "/console/support";
                      return (
                        <Link
                          key={sub.label}
                          href={sub.href}
                          className={[
                            "flex items-center justify-between rounded-xl px-3 py-2 text-xs transition",
                            active
                              ? "bg-fuchsia-500/15 text-fuchsia-100 shadow-[inset_0_0_0_1px_rgba(217,70,239,0.25)]"
                              : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                          ].join(" ")}
                        >
                          <span className="inline-flex items-center gap-2">
                            {sub.label === "Abigail Chat" ? <Sparkles className="h-3.5 w-3.5" /> : null}
                            {sub.label === "Tickets" ? <Inbox className="h-3.5 w-3.5" /> : null}
                            {sub.label === "Knowledge Base" ? <BookOpen className="h-3.5 w-3.5" /> : null}
                            {sub.label === "Announcements" ? <Bell className="h-3.5 w-3.5" /> : null}
                            {sub.label}
                          </span>
                          {sub.label === "Abigail Chat" ? (
                            <span className="rounded-full bg-fuchsia-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">Live</span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
    </SidebarChrome>
  );
};
