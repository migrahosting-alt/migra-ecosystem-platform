"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { AccountLinks } from "@/lib/account-links";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

const navigation = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/platform", label: "Platform" },
  { href: "/products", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/developers", label: "Developers" },
  { href: "/downloads", label: "Downloads" },
  { href: "/services", label: "Services" },
  { href: "/security", label: "Security" },
  { href: "/company", label: "Company" },
] as const;

export function SiteHeader({ accountLinks }: { accountLinks: AccountLinks }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="site-header sticky top-0 z-50 px-4 pt-4 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <nav
          className="site-header-shell relative overflow-hidden rounded-[28px] border border-white/35 bg-white/82 px-4 py-3 shadow-[0_24px_80px_rgba(8,15,36,0.14)] backdrop-blur-xl sm:px-5 sm:py-4 lg:px-6"
          role="navigation"
          aria-label="Main"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(37,99,235,0.6),transparent)]" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-[radial-gradient(circle_at_left,rgba(56,189,248,0.14),transparent_72%)]" />

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-80">
                <div className="relative h-10 w-10 overflow-hidden rounded-2xl border border-white/70 bg-white/90 p-1 shadow-[0_8px_16px_rgba(15,23,42,0.08)] sm:h-11 sm:w-11">
                  <Image
                    src="/brands/products/migrateck.png"
                    alt="MigraTeck"
                    fill
                    sizes="44px"
                    className="object-contain"
                    priority
                  />
                </div>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500 sm:text-[11px]">
                    Enterprise systems
                  </span>
                  <span className="mt-1 truncate font-[var(--font-display)] text-base font-bold tracking-tight text-slate-950 sm:text-lg">
                    MigraTeck
                  </span>
                </span>
              </Link>

              <div className="flex items-center gap-2 lg:hidden">
                <Link
                  href={accountLinks.signup}
                  className="hidden rounded-full border border-sky-200/80 bg-sky-50/80 px-3 py-2 text-xs font-semibold text-sky-900 shadow-sm sm:inline-flex"
                >
                  Create account
                </Link>
                <button
                  type="button"
                  aria-label={mobileOpen ? "Close menu" : "Open menu"}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
                  onClick={() => setMobileOpen((v) => !v)}
                >
                  {mobileOpen ? (
                    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4l14 14M18 4L4 18" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h16M3 11h16M3 16h16" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="hidden items-center rounded-full border border-slate-200/90 bg-white/80 px-2 py-1 lg:flex">
              {navigation.map((item) => (
                <Link key={item.href} href={item.href} className={ui.navLink}>
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="hidden items-center gap-3 sm:flex lg:flex-shrink-0">
              <Link href={accountLinks.login} className={ui.btnGhost}>
                Log in
              </Link>
              <Link href={accountLinks.signup} className={ui.btnPrimary}>
                Create account
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {navigation.slice(0, 5).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-full border border-slate-200/80 bg-white/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950"
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="shrink-0 rounded-full border border-sky-200/80 bg-sky-50/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-sky-900"
            >
              {mobileOpen ? "Close" : "More"}
            </button>
          </div>
        </nav>

        {mobileOpen && (
          <div className="site-header-panel mt-3 overflow-hidden rounded-[28px] border border-white/35 bg-white/94 p-6 shadow-[0_28px_90px_rgba(8,15,36,0.16)] backdrop-blur-xl lg:hidden">
            <div className="grid gap-3 sm:grid-cols-2">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="mt-6 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(248,250,252,0.9))] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Platform access
              </p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">
                Move from product discovery to account creation without dropping out of the same branded control surface.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Link href={accountLinks.signup} className={cn(ui.btnPrimary, "w-full")} onClick={() => setMobileOpen(false)}>
                  Create account
                </Link>
                <Link href={accountLinks.login} className={cn(ui.btnSecondary, "w-full")} onClick={() => setMobileOpen(false)}>
                  Log in
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
