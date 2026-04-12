import { PublicAccessRequestForm } from "@/components/marketing/public-access-request-form";
import { getMigraHostingVpsPlan, type MigraHostingBillingCycle } from "@/lib/migrahosting-pricing";

export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedProduct = typeof params.product === "string" ? params.product : undefined;
  const requestedPlan = typeof params.plan === "string" ? params.plan : undefined;
  const requestedBilling = typeof params.billing === "string" ? params.billing : undefined;
  const billingPreference: MigraHostingBillingCycle | undefined =
    requestedBilling === "monthly" || requestedBilling === "yearly" ? requestedBilling : undefined;
  const selectedPlan = requestedProduct === "migrahosting" ? getMigraHostingVpsPlan(requestedPlan) : undefined;
  const interestContext =
    requestedProduct === "migrahosting"
      ? {
          productInterest: "MigraHosting VPS",
          planInterest: selectedPlan?.name,
          billingPreference,
          sourceContext: selectedPlan ? "marketing:pricing:vps-plan" : "marketing:pricing:vps",
          defaultUseCase: selectedPlan
            ? `We are evaluating ${selectedPlan.name}${billingPreference === "yearly" ? " on annual billing" : ""} for our production workload. We need deployment guidance, target region confirmation, and onboarding timing.`
            : undefined,
        }
      : undefined;
  const intro = selectedPlan
    ? `Include workload details, target rollout timing, and management expectations for ${selectedPlan.name} so operations can review the fit quickly.`
    : "Include your company context, expected rollout goals, and initial timeline so we can triage quickly.";

  return (
    <section className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <h1 className="text-4xl font-black tracking-tight">Request access</h1>
      <p className="text-sm text-[var(--ink-muted)]">
        Submit your onboarding request for platform operations review. Use your work email so we can share approval and setup
        details.
      </p>
      <PublicAccessRequestForm
        source="request_access_page"
        intro={intro}
        interestContext={interestContext}
      />
    </section>
  );
}
