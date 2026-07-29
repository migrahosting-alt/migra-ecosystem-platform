"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import {
  ANNOUPALE_NAV_GROUPS as GROUPS,
  isActiveNav as isActive,
} from "./annoupale-nav";

export function AnnoupaleSidebar() {
  const pathname = usePathname() ?? "/console/annoupale";
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={[
        "hidden shrink-0 flex-col border-r border-white/5 bg-[#0b1020]/95 backdrop-blur lg:flex",
        collapsed ? "w-[68px]" : "w-64",
      ].join(" ")}
    >
      <div className="flex items-center gap-3 px-4 py-5">
        <Link href="/console/annoupale" className="flex min-w-0 items-center gap-3">
          <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-lg shadow-fuchsia-950/20">
            <Image
              src="/brands/products/annoupale.png"
              alt="AnnouPale"
              fill
              sizes="40px"
              className="object-contain p-0.5"
            />
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-white">AnnouPale</span>
              <span className="block text-[10px] uppercase tracking-[0.22em] text-fuchsia-300/70">
                Trust &amp; Operations
              </span>
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {GROUPS.map((group) => (
          <div key={group.heading} className="mb-4">
            {!collapsed && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                {group.heading}
              </p>
            )}
            <ul className="space-y-0.5 text-sm">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
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
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mx-3 mb-3">
        <Link
          href="/console"
          className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400 transition hover:border-fuchsia-400/30 hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span className="truncate">MigraPanel Console</span>}
        </Link>
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="mx-3 mb-4 flex items-center justify-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-[11px] text-slate-400 transition hover:bg-white/10 hover:text-white"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
