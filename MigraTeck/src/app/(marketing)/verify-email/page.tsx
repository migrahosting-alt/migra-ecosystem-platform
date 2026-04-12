import { Suspense } from "react";
import { headers } from "next/headers";
import { VerifyEmailCard } from "@/components/auth/verify-email-card";
import { resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

export default async function VerifyEmailPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);

  return (
    <section className="px-6 py-16">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
          {authBranding.verifyLabel}
        </span>
        <h1 className="text-3xl font-black tracking-tight">{authBranding.verifyHeading}</h1>
        <p className="text-[var(--ink-muted)]">{authBranding.verifyDescription}</p>
        <Suspense
          fallback={<div className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm">Verifying...</div>}
        >
          <VerifyEmailCard />
        </Suspense>
      </div>
    </section>
  );
}
