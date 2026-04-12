import { Suspense } from "react";
import { headers } from "next/headers";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

export default async function ResetPasswordPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);

  return (
    <section className="px-6 py-16">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
          {authBranding.recoveryLabel}
        </span>
        <h1 className="text-3xl font-black tracking-tight">{authBranding.resetHeading}</h1>
        <p className="text-[var(--ink-muted)]">{authBranding.resetDescription}</p>
        <Suspense
          fallback={<div className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm">Loading form...</div>}
        >
          <ResetPasswordForm />
        </Suspense>
      </div>
    </section>
  );
}
