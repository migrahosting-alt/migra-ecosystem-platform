"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

const navigation = [
  { href: "/platform", label: "Platform" },
  { href: "/products", label: "Products" },
  { href: "/developers", label: "Developers" },
  { href: "/downloads", label: "Downloads" },
  { href: "/services", label: "Services" },
  { href: "/security", label: "Security" },
  { href: "/company", label: "Company" },
] as const;

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="absolute top-0 left-0 right-0 z-50">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <nav
          className="flex items-center justify-between py-5"
          role="navigation"
          aria-label="Main"
        >
          {/* logo */}
          <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            <div className="relative h-9 w-9 overflow-hidden rounded-lg">
              <Image
                src="/brands/products/migrateck.png"
                alt="MigraTeck"
                fill
                sizes="36px"
                className="object-contain"
                priority
              />
            </div>
            <span className="hidden font-[var(--font-display)] text-[15px] font-bold tracking-tight text-white sm:block">
              MigraTeck
            </span>
          </Link>

          {/* desktop nav */}
          <div className="hidden items-center gap-0.5 lg:flex">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} className={ui.navLinkDark}>
                {item.label}
              </Link>
            ))}
          </div>

          {/* desktop CTAs */}
          <div className="hidden items-center gap-3 sm:flex">
            <Link href="/products" className={ui.btnGhostDark}>
              Products
            </Link>
            <Link
              href="/developers"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/20 border border-white/15"
            >
              Get started
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* mobile toggle */}
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white/80 transition-colors hover:text-white lg:hidden"
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
        </nav>

        {/* mobile menu */}
        {mobileOpen && (
          <div className="rounded-2xl border border-white/10 bg-slate-900/95 p-6 backdrop-blur-xl lg:hidden">
            <div className="flex flex-col gap-1">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-xl px-4 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white"
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="mt-6 border-t border-white/10 pt-6">
              <Link href="/developers" className={cn(ui.btnPrimaryLight, "w-full")} onClick={() => setMobileOpen(false)}>
                Get started
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
