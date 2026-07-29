import Image from "next/image";
import Link from "next/link";
import {
  ClipboardCheck,
  Scale,
  Flag,
  ScrollText,
  LineChart,
  LayoutDashboard,
  Boxes,
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
  ChevronLeft,
  Activity,
} from "lucide-react";
import { getSession } from "../lib/auth";
import { canViewAccounts, canViewReports, getPaleRole } from "../lib/pale-rbac";
import { visibleNav, type NavCapability, type NavItem } from "./nav-model";

/** Lucide components by registry name. Keeps nav-model.ts free of React imports. */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Boxes, Server, Globe, Mail, Inbox, Phone, FileText, Megaphone,
  Workflow, Receipt, Users, LifeBuoy, BarChart3, Shield, UsersRound, Settings, Activity,
  ClipboardCheck, Scale, Flag, ScrollText, LineChart,
};


/** One nav entry, plus its indented children when the entry is a group. */
const NavRow = ({ item, activePath }: { item: NavItem; activePath: string }) => {
  const isActive = (href: string) =>
    activePath === href || (href !== "/console" && activePath.startsWith(href));
  const active = isActive(item.href);
  const Icon = item.icon ? ICONS[item.icon] : undefined;
  return (
    <li>
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
        <span className="truncate">{item.label}</span>
      </Link>

      {item.children && item.children.length > 0 ? (
        // Indented and hairline-anchored so the group reads as belonging to its parent
        // rather than as more top-level entries.
        <ul className="mt-0.5 space-y-0.5 border-l border-white/5 pl-3 ml-[1.375rem]">
          {item.children.map((child) => {
            const childActive = isActive(child.href);
            const ChildIcon = child.icon ? ICONS[child.icon] : undefined;
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  prefetch
                  className={[
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition",
                    childActive
                      ? "bg-gradient-to-r from-fuchsia-500/10 via-purple-500/5 to-transparent text-white"
                      : "text-slate-500 hover:bg-white/5 hover:text-slate-200",
                  ].join(" ")}
                >
                  {ChildIcon ? (
                    <ChildIcon
                      className={[
                        "h-3.5 w-3.5 shrink-0 transition",
                        childActive ? "text-fuchsia-300" : "text-slate-600 group-hover:text-slate-400",
                      ].join(" ")}
                    />
                  ) : null}
                  <span className="truncate">{child.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
};

export const Sidebar = async ({ activePath }: { activePath: string }) => {
  // Sidebar visibility is CONVENIENCE ONLY. Every destination re-checks authorization
  // server-side; hiding a link avoids offering a door that would be shut, and never
  // substitutes for the lock.
  const session = await getSession();
  const paleRole = getPaleRole(session);
  const granted = new Set<NavCapability>();
  if (canViewAccounts(paleRole)) granted.add("pale.accounts.read");
  if (canViewReports(paleRole)) granted.add("pale.reports.read");
  const nav = visibleNav(granted);

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
          {nav.map((item) => (
            <NavRow key={item.href} item={item} activePath={activePath} />
          ))}
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
          prefetch
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
