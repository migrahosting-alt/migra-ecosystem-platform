"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PUBLIC_NAV_ITEMS } from "@/lib/constants";
import { AuthPortalBranding, isMigraDriveAuthPath } from "@/lib/migradrive-auth-branding";
import { LinkButton } from "@/components/ui/button";

export function SiteHeader({ authBranding }: { authBranding: AuthPortalBranding }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAuthRoute = isMigraDriveAuthPath(pathname);
  const showLoginButton = isAuthRoute ? pathname !== "/login" : true;
  const showSignupButton = isAuthRoute ? pathname !== "/signup" : true;

  return (
    <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <div className="relative overflow-hidden rounded-[28px] border border-[var(--line)] bg-white/82 px-4 py-3 shadow-[0_18px_40px_rgba(10,22,40,0.08)] backdrop-blur sm:px-6 sm:py-4">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(26,168,188,0.7),transparent)]" />

          <div className="flex items-center justify-between gap-4">
            <Link href={isAuthRoute ? authBranding.siteUrl : "/"} className="flex items-center gap-3">
              <Image
                src={isAuthRoute ? "/brand/migrateck-logo-mt-40.png" : "/brand/migrateck-logo-mt-40.png"}
                alt={isAuthRoute ? `${authBranding.productName} logo` : "MigraTeck logo"}
                width={40}
                height={40}
                className="h-10 w-10 rounded-2xl border border-white/70 bg-white/80 p-1 shadow-[0_8px_16px_rgba(10,22,40,0.08)]"
                unoptimized
              />
              <span className="flex flex-col">
                <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                  {isAuthRoute ? authBranding.headerLabel : "Enterprise systems"}
                </span>
                <span className="mt-1 font-[var(--font-space-grotesk)] text-lg font-bold tracking-[-0.04em] text-[var(--ink)]">
                  {isAuthRoute ? authBranding.shortName : "MigraTeck"}
                </span>
              </span>
            </Link>

            <nav className="hidden items-center rounded-full border border-[var(--line)] bg-white/80 px-2 py-1 lg:flex">
              {isAuthRoute
                ? null
                : PUBLIC_NAV_ITEMS.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="px-3 py-2 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
                    >
                      {item.label}
                    </Link>
                  ))}
            </nav>

            <div className="flex items-center gap-3">
              {showLoginButton ? (
                <LinkButton href="/login" variant="ghost" className="hidden sm:inline-flex">
                  Log in
                </LinkButton>
              ) : null}
              {showSignupButton ? (
                <LinkButton href="/signup">{isAuthRoute ? "Create account" : "Enter platform"}</LinkButton>
              ) : null}
              {!isAuthRoute ? (
                <button
                  type="button"
                  aria-label={mobileOpen ? "Close menu" : "Open menu"}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--ink)] transition hover:bg-white/70 lg:hidden"
                  onClick={() => setMobileOpen((value) => !value)}
                >
                  {mobileOpen ? (
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4l12 12M16 4L4 16" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h14M3 10h14M3 14h14" />
                    </svg>
                  )}
                </button>
              ) : null}
            </div>
          </div>

          {mobileOpen && !isAuthRoute ? (
            <nav className="mt-4 grid gap-1 border-t border-[var(--line)] pt-4 lg:hidden">
              {PUBLIC_NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-2xl px-4 py-3 text-sm font-semibold text-[var(--ink-muted)] transition hover:bg-white/70 hover:text-[var(--ink)]"
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </div>
    </header>
  );
}
