import { AnimatedSection } from "@/components/marketing/animated-section";
import { MarketingPageHero } from "@/components/marketing/page-hero";

const architectureCards = [
  {
    title: "Public surface",
    description: "Pages for positioning, pricing, product discovery, and developer onboarding under one trust boundary.",
  },
  {
    title: "Authenticated surface",
    description: "Tenant-aware dashboard for organizations, downloads, security flows, billing, and product launch control.",
  },
  {
    title: "Execution layer",
    description: "Provisioning, billing synchronization, access decisions, and audit-ready operational workflows.",
  },
  {
    title: "Expansion model",
    description: "Downstream products plug into shared identity, permissions, and orchestration instead of duplicating platform concerns.",
  },
] as const;

export default function PlatformPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Platform"
        title="Platform architecture that explains how the business actually works."
        description="migrateck.com combines marketing and authenticated product surfaces in one deployment, with centralized identity, multi-tenant data, RBAC, billing sync, and audit-ready expansion paths."
        stats={[
          { label: "Surfaces", value: "2", detail: "Public and authenticated." },
          { label: "Shared layer", value: "Identity" },
          { label: "Expansion mode", value: "Modular", detail: "Downstream products inherit the same core controls." },
        ]}
      />

      <section className="px-6 pb-16">
        <div className="mx-auto grid w-full max-w-7xl gap-4 md:grid-cols-2 xl:grid-cols-4">
          {architectureCards.map((card, index) => (
            <AnimatedSection key={card.title} delay={0.06 * index}>
              <article className="h-full rounded-[1.75rem] border border-[var(--line)] bg-white/88 p-6 shadow-[0_18px_40px_rgba(10,22,40,0.05)] backdrop-blur">
                <h2 className="font-[var(--font-space-grotesk)] text-2xl font-bold tracking-[-0.04em] text-[var(--ink)]">{card.title}</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">{card.description}</p>
              </article>
            </AnimatedSection>
          ))}
        </div>
      </section>
    </>
  );
}
