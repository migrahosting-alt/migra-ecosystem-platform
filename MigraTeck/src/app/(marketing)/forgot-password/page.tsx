import { headers } from "next/headers";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

export default async function ForgotPasswordPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);

  return (
    <section className="px-6 py-16">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
          {authBranding.recoveryLabel}
        </span>
        <h1 className="text-3xl font-black tracking-tight">{authBranding.recoveryHeading}</h1>
        <p className="text-[var(--ink-muted)]">{authBranding.recoveryDescription}</p>
        <ForgotPasswordForm />
      </div>
    </section>
  );
}
