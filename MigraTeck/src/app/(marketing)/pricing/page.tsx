import Link from "next/link";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { PRODUCT_CATALOG, type PricingTier } from "@/lib/constants";
import { MigraHostingVpsPricing } from "@/components/marketing/migrahosting-vps-pricing";

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatPrice(tier: PricingTier): string {
  if (tier.contactSales) return "Custom";
  if (tier.monthlyPrice === 0) return "Free";
   const dollars = tier.monthlyPrice / 100;
   return priceFormatter.format(dollars).replace(/\.5(?!\d)/, ".50");
}

function tierHref(productKey: string, tier: PricingTier): string {
  if (tier.contactSales) return "/contact";
  if (tier.stripePriceId) {
    return `/app/billing?priceId=${tier.stripePriceId}`;
  }
  // Free tier — just sign up
  return `/signup?product=${productKey}`;
}

function tierActionLabel(tier: PricingTier): string {
  if (tier.contactSales) return "Contact Sales";
  if (tier.monthlyPrice === 0) return "Get Started Free";
  return "Start Free Trial";
}

export default function PricingPage() {
  const purchasable = PRODUCT_CATALOG.filter((p) => p.purchasable && p.pricing?.length);

  return (
    <>
      <MarketingPageHero
        eyebrow="Pricing"
        title="Pricing that reads like a platform catalog, not a loose sales sheet."
        description="Dedicated infrastructure and software subscriptions are presented through a common pricing structure, with clear self-serve versus reviewed provisioning expectations."
        stats={[
          { label: "Purchasable products", value: String(purchasable.length) },
          { label: "Provisioning mode", value: "Mixed" },
          { label: "Commercial posture", value: "Clear", detail: "Self-serve where appropriate, reviewed where required." },
        ]}
      />

      <section className="px-6 pb-16">
        <div className="mx-auto w-full max-w-6xl">

        <MigraHostingVpsPricing />

        {purchasable.map((product) => (
          <div key={product.key} className="mb-16">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-600)]">{product.code}</p>
              <h2 className="mt-1 font-[var(--font-space-grotesk)] text-3xl font-bold tracking-[-0.04em]">{product.name}</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{product.description}</p>
            </div>

            <div className={`grid gap-6 ${product.pricing!.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
              {product.pricing!.map((tier) => (
                <div
                  key={`${product.key}-${tier.name}`}
                  className={`relative flex flex-col rounded-[1.75rem] border p-6 shadow-[0_18px_40px_rgba(10,22,40,0.05)] ${
                    tier.highlighted
                      ? "border-[var(--brand-600)] bg-[var(--brand-50)]"
                      : "border-[var(--line)] bg-white/88 backdrop-blur"
                  }`}
                >
                  {tier.highlighted && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[linear-gradient(180deg,#0a1628,#0e2237)] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                      Most Popular
                    </span>
                  )}
                  <h3 className="text-lg font-bold">{tier.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-black tracking-tight">{formatPrice(tier)}</span>
                    {!tier.contactSales && tier.monthlyPrice > 0 && (
                      <span className="text-sm text-[var(--ink-muted)]">/mo</span>
                    )}
                  </div>
                  <ul className="mt-6 flex-1 space-y-2">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 text-[var(--brand-600)]">&#10003;</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={tierHref(product.key, tier)}
                    className={`mt-6 block rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                      tier.highlighted
                        ? "bg-[var(--brand-600)] text-white hover:bg-[var(--brand-700)]"
                        : "border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    {tierActionLabel(tier)}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-8 rounded-[2rem] border border-[var(--line)] bg-[var(--surface-3)] p-8 text-center shadow-[0_18px_40px_rgba(10,22,40,0.05)]">
          <h3 className="text-xl font-bold">Need a custom solution?</h3>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Enterprise customers get dedicated infrastructure, custom SLAs, and volume discounts.
          </p>
          <Link
            href="/request-access"
            className="mt-4 inline-block rounded-xl bg-[var(--brand-600)] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[var(--brand-700)]"
          >
            Contact Sales
          </Link>
        </div>
        </div>
      </section>
    </>
  );
}
