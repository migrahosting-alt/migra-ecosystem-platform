import { AnimatedSection } from "@/components/marketing/animated-section";
import { MarketingPageHero } from "@/components/marketing/page-hero";

const companySections = [
  {
    title: "Platform-first posture",
    description:
      "MigraTeck is presented as an operating system for products, access, pricing, and execution instead of a loose collection of properties.",
  },
  {
    title: "Disciplined system design",
    description:
      "Identity, permissions, billing, and orchestration are treated as shared primitives so product surfaces can scale without drifting apart.",
  },
  {
    title: "Commercial clarity",
    description:
      "The public site now aligns products, pricing, and services under one visual and narrative structure, making the business easier to understand.",
  },
] as const;

export default function CompanyPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Company"
        title="A cleaner company story for a serious platform business."
        description="MigraTeck builds integrated platform products with centralized identity, access governance, commercial control, and operational scale. The public site now reflects that with a tighter narrative and a more credible visual system."
        stats={[
          { label: "Company mode", value: "Platform" },
          { label: "Shared primitives", value: "Identity" },
          { label: "Public posture", value: "Unified", detail: "Products, pricing, and services now read together." },
        ]}
      />

      <section className="px-6 pb-16">
        <div className="mx-auto grid w-full max-w-7xl gap-4 md:grid-cols-3">
          {companySections.map((section, index) => (
            <AnimatedSection key={section.title} delay={0.06 * index}>
              <article className="h-full rounded-[1.75rem] border border-[var(--line)] bg-white/88 p-6 shadow-[0_18px_40px_rgba(10,22,40,0.05)] backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">Company view</p>
                <h2 className="mt-3 font-[var(--font-space-grotesk)] text-2xl font-bold tracking-[-0.04em] text-[var(--ink)]">{section.title}</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">{section.description}</p>
              </article>
            </AnimatedSection>
          ))}
        </div>
      </section>
    </>
  );
}
