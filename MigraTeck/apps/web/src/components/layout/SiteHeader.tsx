"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { AccountLinks } from "@/lib/account-links";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

const navigation = [
  { href: "/products", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/services", label: "Services" },
  { href: "/support/elize-foundation-mail", label: "Email Setup" },
  { href: "/security", label: "Security" },
  { href: "/company", label: "Company" },
] as const;

export function SiteHeader({ accountLinks }: { accountLinks: AccountLinks }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="site-header sticky top-0 z-50 px-4 pt-4 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <nav
          className="site-header-shell page-glow relative overflow-hidden rounded-[30px] border border-white/70 bg-[rgba(255,255,255,0.78)] px-4 py-3 shadow-[var(--shadow-lg)] backdrop-blur-xl sm:px-5 sm:py-4 lg:px-6"
          role="navigation"
          aria-label="Main"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(217,70,239,0.24),transparent)]" />
          <div className="pointer-events-none absolute -left-10 top-0 h-24 w-24 rounded-full bg-fuchsia-200/50 blur-3xl" />
          <div className="pointer-events-none absolute -right-8 top-2 h-20 w-20 rounded-full bg-orange-200/60 blur-3xl" />

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" className="flex min-w-0 items-center gap-3">
                <div className={ui.logoBadge}>
                  <Image
                    src="/brands/products/migrateck-official.png"
                    alt="MigraHosting"
                    fill
                    sizes="44px"
                    className="object-contain"
                    priority
                  />
                </div>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-soft)] sm:text-[11px]">
                    MigraHosting
                  </span>
                  <span className="mt-0.5 truncate font-[var(--font-display)] text-base font-semibold tracking-[-0.03em] text-[var(--brand-ink)] sm:text-lg">
                    Hosting, email, and websites
                  </span>
                </span>
              </Link>

              <div className="flex items-center gap-2 lg:hidden">
                <Link href={accountLinks.login} className="hidden rounded-full border border-[var(--line)] bg-white/80 px-3 py-2 text-xs font-semibold text-[var(--brand-ink)] sm:inline-flex">
                  Client login
                </Link>
                <button
                  type="button"
                  aria-label={mobileOpen ? "Close menu" : "Open menu"}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/80 bg-white/88 text-[var(--brand-ink)] shadow-[0_8px_22px_rgba(109,40,217,0.08)] transition hover:bg-white"
                  onClick={() => setMobileOpen((value) => !value)}
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

            <div className="hidden items-center rounded-full border border-white/80 bg-white/72 px-2 py-1 shadow-[0_10px_28px_rgba(109,40,217,0.06)] lg:flex">
              {navigation.map((item) => (
                <Link key={item.href} href={item.href} className={ui.navLink}>
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="hidden items-center gap-3 sm:flex lg:flex-shrink-0">
              <Link href={accountLinks.login} className={ui.btnGhost}>
                Client Portal
              </Link>
              <Link href="/products/migrahosting" className={ui.btnSecondary}>
                Choose Hosting
              </Link>
              <Link href={accountLinks.signup} className={ui.btnPrimary}>
                Create account
              </Link>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {navigation.slice(0, 4).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-full border border-white/80 bg-white/78 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-muted)] shadow-[0_6px_18px_rgba(109,40,217,0.06)] transition hover:bg-white hover:text-[var(--brand-ink)]"
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setMobileOpen((value) => !value)}
              className="shrink-0 rounded-full border border-white/80 bg-white/78 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-muted)] shadow-[0_6px_18px_rgba(109,40,217,0.06)]"
            >
              {mobileOpen ? "Close" : "More"}
            </button>
          </div>
        </nav>

        {mobileOpen ? (
          <div className="site-header-panel page-glow mt-3 overflow-hidden rounded-[30px] border border-white/80 bg-[rgba(255,255,255,0.86)] p-6 shadow-[var(--shadow-lg)] backdrop-blur-xl lg:hidden">
            <div className="grid gap-3 sm:grid-cols-2">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-[22px] border border-white/80 bg-white/82 px-4 py-3 text-sm font-semibold text-[var(--brand-ink)] shadow-[0_8px_24px_rgba(109,40,217,0.06)] transition hover:-translate-y-0.5 hover:bg-white"
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="mt-6 rounded-[24px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(250,244,255,0.94),rgba(255,247,241,0.94))] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-soft)]">
                Client access
              </p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--brand-muted)]">
                Manage domains, hosting, invoices, and support from one simple client portal.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Link href={accountLinks.login} className={cn(ui.btnSecondary, "w-full")} onClick={() => setMobileOpen(false)}>
                  Client Portal
                </Link>
                <Link href={accountLinks.signup} className={cn(ui.btnPrimary, "w-full")} onClick={() => setMobileOpen(false)}>
                  Create account
                </Link>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
