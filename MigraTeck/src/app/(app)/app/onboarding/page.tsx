import { redirect } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { OnboardingWizardClient } from "@/components/app/onboarding-wizard-client";

export default async function OnboardingPage() {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);
  if (!ctx) redirect("/app");

  const entitlements = await prisma.orgEntitlement.findMany({
    where: { orgId: ctx.orgId },
    select: { product: true, status: true },
  });

  const activeProducts = entitlements
    .filter((e) => e.status === "ACTIVE" || e.status === "TRIAL")
    .map((e) => e.product);

  return (
    <section className="space-y-6">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Getting started</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Ecosystem Onboarding</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
          Tell us about your business and we&apos;ll recommend the best MigraTeck products for you.
        </p>
      </article>

      <OnboardingWizardClient activeProducts={activeProducts} orgId={ctx.orgId} />
    </section>
  );
}
