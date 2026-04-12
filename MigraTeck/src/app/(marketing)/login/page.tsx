import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);

  return {
    title: authBranding.heading,
    description: authBranding.description,
  };
}

export default async function LoginPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);

  return (
    <section className="px-6 py-16">
      <div className="mx-auto grid w-full max-w-5xl gap-8 md:grid-cols-[1fr_1.2fr] md:items-start">
        <div className="space-y-6">
          <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            {authBranding.sectionLabel}
          </span>
          <div>
            <h1 className="text-4xl font-black tracking-tight">{authBranding.heading}</h1>
            <p className="mt-3 text-[var(--ink-muted)]">{authBranding.description}</p>
          </div>
          <div className="grid gap-3 text-sm text-[var(--ink-muted)]">
            {authBranding.featureBullets.map((feature) => (
              <div key={feature} className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3">
                {feature}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 text-sm">
            <Link href="/signup" className="font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]">
              Need access? Create an account
            </Link>
            <Link
              href="/forgot-password"
              className="font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]"
            >
              Forgot password?
            </Link>
          </div>
        </div>
        <Suspense
          fallback={<div className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm">Loading form...</div>}
        >
          <LoginForm authBranding={authBranding} />
        </Suspense>
      </div>
    </section>
  );
}
