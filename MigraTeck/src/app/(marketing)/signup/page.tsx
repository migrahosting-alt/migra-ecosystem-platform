import Link from "next/link";
import { headers } from "next/headers";
import { SignupForm } from "@/components/auth/signup-form";
import { PublicAccessRequestForm } from "@/components/marketing/public-access-request-form";
import { getDefaultMigraDrivePlanConfig } from "@/lib/drive/drive-plan-config";
import { resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";
import { getPlatformConfig } from "@/lib/platform-config";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);
  const platformConfig = await getPlatformConfig();
  const starterPlan = getDefaultMigraDrivePlanConfig();
  const signupBlocked = !platformConfig.allowPublicSignup || platformConfig.maintenanceMode || platformConfig.freezeProvisioning;
  const signupBlockedIntro = platformConfig.maintenanceMode
    ? "MigraDrive maintenance is active. Submit your details and we will onboard your team once public signup resumes."
    : platformConfig.freezeProvisioning
      ? "MigraDrive provisioning is currently paused. Submit your details and operations will contact you with next steps."
      : platformConfig.waitlistMode
        ? "MigraDrive waitlist mode is active. Submit your details to reserve onboarding priority."
        : "Signup is temporarily restricted. Submit your details and MigraDrive onboarding will follow up.";

  return (
    <section className="px-6 py-16">
      <div className="mx-auto grid w-full max-w-5xl gap-8 md:grid-cols-[1fr_1.2fr] md:items-start">
        <div className="space-y-6">
          <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            {authBranding.productName} secure onboarding
          </span>
          <div>
            <h1 className="text-4xl font-black tracking-tight">Create your {authBranding.productName} account</h1>
            <p className="mt-3 text-[var(--ink-muted)]">
              Create secure access for your team and continue into the portal with owner-level controls in one flow.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-[var(--ink-muted)]">
            <div className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3">
              {host === "vps.migrahosting.com"
                ? "Provision your first VPS workspace and manage infrastructure, console sessions, backups, and billing in one place."
                : `${starterPlan.storageQuotaGb} GiB starter capacity is provisioned with every new MigraDrive tenant.`}
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3">
              Email, password, and optional text-message sign-in keep portal access flexible without exposing operator tooling.
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3">
              Owner accounts can invite teammates, manage services, and continue into the workspace immediately after verification.
            </div>
          </div>
          <p className="mt-3 text-[var(--ink-muted)]">
            Already have an account?
            {" "}
            <Link href="/login" className="font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]">
              Log in here
            </Link>
            .
          </p>
        </div>
        {signupBlocked ? (
          <PublicAccessRequestForm source="signup_blocked" intro={signupBlockedIntro} />
        ) : (
          <SignupForm />
        )}
      </div>
    </section>
  );
}
