"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEGAL_PAGE_PATHS } from "@/lib/legal";
import { isMigraDriveAuthPath } from "@/lib/migradrive-auth-branding";
import type { AuthPortalBranding } from "@/lib/migradrive-auth-branding";
import { requestOpenCookiePreferences } from "@/lib/privacy/cookie-consent";

export function SiteFooter({ authBranding }: { authBranding: AuthPortalBranding }) {
  const pathname = usePathname();
  const isAuthRoute = isMigraDriveAuthPath(pathname);

  return (
    <footer className="px-6 pb-12 pt-4 sm:pb-14">
      <div className="mx-auto w-full max-w-7xl overflow-hidden rounded-[2rem] border border-slate-700 bg-[radial-gradient(circle_at_top_left,rgba(26,168,188,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(245,197,83,0.14),transparent_24%),linear-gradient(180deg,#09111d,#122033)] p-8 text-white shadow-[0_30px_80px_rgba(10,22,40,0.3)]">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              {isAuthRoute ? authBranding.footerLabel : "MigraTeck ecosystem"}
            </p>
            <h2 className="mt-3 max-w-xl font-[var(--font-space-grotesk)] text-3xl font-bold tracking-[-0.05em] text-white">
              {isAuthRoute
                ? authBranding.footerHeading
                : "One platform story across products, pricing, services, and operational trust."}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              © {new Date().getFullYear()} {isAuthRoute ? authBranding.productName : "MigraTeck"}.{" "}
              {isAuthRoute
                ? authBranding.footerDescription
                : "Enterprise platform access, pricing, services, and product discovery presented through one coordinated site."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {isAuthRoute ? (
              <a href={authBranding.siteUrl} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
                {authBranding.siteLabel}
              </a>
            ) : (
              <>
                <Link href="/portfolio" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
                  Portfolio
                </Link>
                <Link href="/services" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
                  Services
                </Link>
                <Link href="/company" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
                  Company
                </Link>
                <Link href="/developers" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
                  Developers
                </Link>
                <Link href="/products" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
                  Products
                </Link>
                <Link href="/pricing" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
                  Pricing
                </Link>
              </>
            )}
            <Link href={LEGAL_PAGE_PATHS.privacy} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
              Privacy Policy
            </Link>
            <Link href={LEGAL_PAGE_PATHS.terms} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
              Terms of Service
            </Link>
            <button type="button" onClick={requestOpenCookiePreferences} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10">
              Cookie Preferences
            </button>
            <a href={`mailto:${isAuthRoute ? authBranding.supportEmail : "support@migrateck.com"}`} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10">
              Support
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
