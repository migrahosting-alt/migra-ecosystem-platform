"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BadgeDollarSign,
  BookOpenCheck,
  Boxes,
  Building2,
  ChartNoAxesCombined,
  Code2,
  CreditCard,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ShieldCheck,
  UserRoundCog,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

type PlatformNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  planned?: boolean;
};

type PlatformNavGroup = {
  heading: string;
  items: PlatformNavItem[];
};

const platformNav: PlatformNavGroup[] = [
  {
    heading: "Home",
    items: [
      { href: "/platform/overview", label: "Overview", icon: LayoutDashboard },
    ],
  },
  {
    heading: "Organization",
    items: [
      { href: "/platform/organizations", label: "Organizations", icon: Building2 },
      { href: "/platform/members", label: "Members & Access", icon: UserRoundCog },
    ],
  },
  {
    heading: "Developers",
    items: [
      { href: "/platform/developers", label: "Developer Platform", icon: Code2 },
      { href: "/platform/developers/api-keys", label: "API Keys", icon: KeyRound },
      { href: "/platform/developers/oauth", label: "OAuth Apps", icon: Boxes },
      { href: "/platform/developers/webhooks", label: "Webhooks & Events", icon: Webhook },
      { href: "/platform/usage", label: "API & Usage", icon: Activity },
    ],
  },
  {
    heading: "Commerce",
    items: [
      { href: "/platform/commerce", label: "Commerce Overview", icon: BadgeDollarSign },
      { href: "/platform/billing", label: "MigraPay & Billing", icon: CreditCard },
      { href: "/platform/commerce/catalog", label: "Catalog & Entitlements", icon: Boxes },
      { href: "/platform/commerce/usage", label: "Usage & Metering", icon: ChartNoAxesCombined },
    ],
  },
  {
    heading: "Trust",
    items: [
      { href: "/platform/trust", label: "Trust Overview", icon: ShieldCheck },
      { href: "/platform/security", label: "Security", icon: ShieldCheck },
      { href: "/platform/compliance", label: "Compliance & Audit", icon: BookOpenCheck },
    ],
  },
] as const;

export function PlatformSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-white/8 bg-[linear-gradient(180deg,#000000,#050a14_58%,#080d18)] text-slate-100">
      <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-xs font-bold text-white shadow-[0_10px_24px_rgba(56,189,248,0.24)]">
          M
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">MigraTeck</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400">
            Platform infrastructure
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {platformNav.map((group) => (
          <div key={group.heading} className="mb-4">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {group.heading}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  (item.href !== "/platform/overview" && pathname.startsWith(item.href + "/"));

                return (
                  <li key={group.heading + ":" + item.href + ":" + item.label}>
                    <Link
                      href={item.planned ? "/platform/developers" : item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-blue-500/14 text-blue-100"
                          : "text-slate-300 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.8}
                        className={cn(active ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-300")}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.planned ? (
                        <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          next
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/8 px-3 py-3">
        <div className="rounded-xl border border-white/8 bg-white/[0.035] px-3.5 py-3.5">
          <div className="flex items-center gap-2 text-cyan-300">
            <Gauge size={15} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Parent platform
            </p>
          </div>
          <p className="mt-2 text-sm font-semibold text-white">Shared primitives first</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Identity, APIs, commerce, metering, and trust live here. Operational execution stays in MigraPanel.
          </p>
        </div>
      </div>
    </aside>
  );
}
