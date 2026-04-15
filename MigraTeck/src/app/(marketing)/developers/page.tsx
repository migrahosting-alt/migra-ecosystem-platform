import { AnimatedSection } from "@/components/marketing/animated-section";
import { MarketingPageHero } from "@/components/marketing/page-hero";

const developerCards = [
  {
    title: "Security defaults",
    description: "Argon2id hashing, strict cookies, CSRF via Auth.js, CSP/HSTS headers, and rate limiting across the stack.",
  },
  {
    title: "Launch bridge",
    description: "Short-lived signed launch token flow prepared for OIDC bridge into product domains and downstream apps.",
  },
  {
    title: "API domains",
    description: "Routes are organized by auth, orgs, products, downloads, audit, and internal operations instead of one oversized mixed surface.",
  },
  {
    title: "Tenant context",
    description: "Core authentication and organization context stay shared across the full stack, keeping integrations consistent.",
  },
] as const;

export default function DevelopersPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Developers"
        title="A developer surface that looks as deliberate as the backend behind it."
        description="API domains are organized by responsibility, and the page now presents security defaults, launch flows, and tenant context with the same clarity as the rest of the site."
        stats={[
          { label: "Route groups", value: "5+", detail: "Auth, orgs, products, downloads, audit, and internal ops." },
          { label: "Tenant model", value: "Shared" },
          { label: "Launch path", value: "Signed", detail: "Prepared for downstream product handoff." },
        ]}
      />

      <section className="px-6 pb-16">
        <div className="mx-auto grid w-full max-w-7xl gap-4 md:grid-cols-2 xl:grid-cols-4">
          {developerCards.map((card, index) => (
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
