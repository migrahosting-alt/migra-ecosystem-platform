import { Chip } from "@/components/ui/chip";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { PRODUCT_CATALOG, type PricingTier } from "@/lib/constants";
import { MIGRAHOSTING_VPS_PLANS } from "@/lib/migrahosting-pricing";

const productBadges = [
  "Requires Organization",
  "Entitlement-Gated",
  "Policy-Controlled",
  "Signed Execution Enabled",
];

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatTierPrice(tier: PricingTier): string {
  if (tier.contactSales) return "Custom";
  if (tier.monthlyPrice === 0) return "Free";
  return `$${priceFormatter.format(tier.monthlyPrice / 100)}/mo`;
}

export default function ProductsMarketingPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Products"
        title="Product ecosystem, centrally managed and easier to scan."
        description="Launch and govern every MigraTeck product through organization-scoped access policies, with pricing cues and entitlement posture visible in one consistent product grid."
        stats={[
          { label: "Products", value: String(PRODUCT_CATALOG.length) },
          { label: "Purchasable", value: String(PRODUCT_CATALOG.filter((product) => product.purchasable).length) },
          { label: "Access model", value: "Scoped", detail: "Organization-aware and policy-controlled." },
        ]}
      />

      <section className="px-6 pb-16">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-8 flex flex-wrap gap-2">
            {productBadges.map((badge) => (
              <Chip key={badge}>{badge}</Chip>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PRODUCT_CATALOG.map((product) => {
            const migraHostingPricing =
              product.key === "MIGRAHOSTING"
                ? MIGRAHOSTING_VPS_PLANS.map((plan) => ({
                    name: plan.name,
                    monthlyPrice: plan.monthlyPriceCents,
                    interval: "month" as const,
                    features: plan.highlights,
                    highlighted: plan.highlighted,
                  }))
                : undefined;
            const pricing = migraHostingPricing || product.pricing;
            const featuredTier = pricing?.find((tier) => tier.highlighted) ?? pricing?.[0];
            const startingTier = pricing?.find((tier) => !tier.contactSales && tier.monthlyPrice > 0) ?? pricing?.[0];

            return (
              <article key={product.key} className="rounded-[1.75rem] border border-[var(--line)] bg-white/88 p-6 shadow-[0_18px_40px_rgba(10,22,40,0.05)] backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{product.key}</p>
                <h2 className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-bold tracking-[-0.04em] text-[var(--ink)]">{product.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{product.description}</p>

                {startingTier ? (
                  <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Starting at</p>
                    <p className="mt-1 text-lg font-bold text-[var(--ink)]">{formatTierPrice(startingTier)}</p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">
                      {featuredTier ? `${featuredTier.name} is the recommended tier.` : "Purchasable product."}
                    </p>
                  </div>
                ) : null}

                {featuredTier ? (
                  <ul className="mt-4 space-y-2 text-sm text-[var(--ink-muted)]">
                    {featuredTier.features.slice(0, 3).map((feature) => (
                      <li key={`${product.key}-${feature}`} className="flex items-start gap-2">
                        <span className="mt-0.5 text-[var(--brand-600)]">&#10003;</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {product.key === "MIGRAHOSTING" ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      Dedicated Compute Only
                    </span>
                  ) : null}
                </div>
                {product.clientOnly ? (
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--accent-600)]">
                    Client access required
                  </p>
                ) : null}
              </article>
            );
          })}
          </div>
        </div>
      </section>
    </>
  );
}
