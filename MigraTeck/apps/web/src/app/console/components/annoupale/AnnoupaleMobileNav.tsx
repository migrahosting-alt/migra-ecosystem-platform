"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ANNOUPALE_NAV_ITEMS, isActiveNav } from "./annoupale-nav";

/**
 * Mobile / tablet navigation for the AnnouPale sub-console. The desktop sidebar
 * is hidden below the `lg` breakpoint, so this horizontally-scrollable strip
 * provides the same destinations (plus a back-to-MigraPanel link) on small
 * screens. Shown only below `lg`.
 */
export function AnnoupaleMobileNav() {
  const pathname = usePathname() ?? "/console/annoupale";
  return (
    <nav className="-mx-5 border-b border-white/5 bg-[#0b1020]/70 px-5 py-2 lg:hidden">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ANNOUPALE_NAV_ITEMS.map((item) => {
          const active = isActiveNav(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition",
                active
                  ? "border-fuchsia-400/40 bg-fuchsia-500/10 text-white"
                  : "border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200",
              ].join(" ")}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? "text-fuchsia-300" : "text-slate-500"}`} />
              {item.label}
            </Link>
          );
        })}
        <Link
          href="/console"
          className="inline-flex shrink-0 items-center rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-[12px] font-medium text-slate-400 transition hover:text-slate-200"
        >
          MigraPanel
        </Link>
      </div>
    </nav>
  );
}
