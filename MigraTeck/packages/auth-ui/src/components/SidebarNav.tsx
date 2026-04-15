"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/cn";
import { Card } from "./Card";
import { AuthLogo } from "./AuthLogo";
import { ThemeToggle } from "./ThemeToggle";
import type { AuthBrandTheme } from "../lib/theme";
import { toBrandStyle } from "../lib/theme";

export function SidebarNav({
  theme,
  items,
  title,
  subtitle,
}: {
  theme: AuthBrandTheme;
  items: Array<{ href: string; label: string; badge?: string }>;
  title: string;
  subtitle: string;
}) {
  const pathname = usePathname();

  return (
    <Card className="p-5" style={toBrandStyle(theme)}>
      <div className="flex items-start justify-between gap-3">
        <AuthLogo theme={theme} compact />
        <ThemeToggle />
      </div>
      <div className="mt-6">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-fuchsia-200">{title}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{subtitle}</p>
      </div>
      <nav className="mt-6 space-y-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between rounded-2xl px-3 py-3 text-sm font-medium transition",
                active
                  ? "bg-[linear-gradient(135deg,rgba(124,58,237,0.26),rgba(236,72,153,0.18))] text-white"
                  : "text-zinc-400 hover:bg-white/6 hover:text-zinc-100",
              )}
            >
              <span>{item.label}</span>
              {item.badge ? (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </Card>
  );
}
