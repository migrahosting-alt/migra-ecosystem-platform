import { headers } from "next/headers";
import { AnimatedSection } from "@/components/marketing/animated-section";
import { HeroSection } from "@/components/marketing/hero";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { LinkButton } from "@/components/ui/button";
import { resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

const pillars = [
  {
    title: "Enterprise Governance Layer",
    description:
      "Policy controls, organization boundaries, risk-tier enforcement, and auditable access decisions.",
  },
  {
    title: "Developer-Capable Platform",
    description:
      "API-ready foundations with deterministic workflows, mutation guards, and extensible service contracts.",
  },
  {
    title: "Infrastructure Orchestration Core",
    description:
      "Signed job execution, replay-safe queues, and deterministic worker behavior across provisioning flows.",
  },
  {
    title: "Product Launch Surface",
    description:
      "Entitlement-aware distribution for products, downloads, and launches through centralized org context.",
  },
];

const executionEngine = [
  "Tier-2 Step-Up Security",
  "Signed Job Envelopes",
  "Deterministic Provisioning FSM",
  "Stripe-Synchronized Entitlements",
  "Audit-Grade Mutation Logs",
];

const architectureLayers = [
  {
    title: "Identity Layer",
    description: "Sessions, verification, and step-up security at account and organization boundaries.",
  },
  {
    title: "Governance Layer",
    description: "RBAC, org-scoped permissions, CSRF/rate controls, and mutation intent enforcement.",
  },
  {
    title: "Entitlement Engine",
    description: "Billing sync, time-bound access windows, and internal-only feature gating.",
  },
  {
    title: "Provisioning Engine",
    description: "Signed envelopes, retry-safe jobs, and deterministic state transitions.",
  },
  {
    title: "Observability Core",
    description: "Audit explorer, denial telemetry, SLO metrics, and worker health visibility.",
  },
];

const aiServiceOffers = [
  {
    title: "AI Website Builder",
    description:
      "Prompt-guided website creation packaged as a managed launch service for clients who need a fast, conversion-ready web presence.",
    cta: "Explore Website Builder",
    href: "/services#ai-website-builder",
    badge: "Free Option Available",
  },
  {
    title: "AI Content Generator",
    description:
      "Recurring content production for blogs, landing pages, product copy, email campaigns, and social publishing workflows.",
    cta: "Explore Content Generator",
    href: "/services#ai-content-generator",
    badge: "Recurring Value Offer",
  },
];

export default async function HomePage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);

  return (
    <div className="min-h-screen">
      <SiteHeader authBranding={authBranding} />
      <main>
        <HeroSection />
        <section className="px-6 pb-12">
          <div className="mx-auto grid w-full max-w-7xl gap-4 md:grid-cols-2 xl:grid-cols-4">
            {pillars.map((pillar, index) => (
              <AnimatedSection key={pillar.title} delay={0.08 * index}>
                <article className="h-full rounded-[1.75rem] border border-[var(--line)] bg-white/88 p-6 shadow-[0_18px_40px_rgba(10,22,40,0.05)] backdrop-blur">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">Core pillar</p>
                  <h3 className="mt-3 font-[var(--font-space-grotesk)] text-2xl font-bold tracking-[-0.04em] text-[var(--ink)]">{pillar.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{pillar.description}</p>
                </article>
              </AnimatedSection>
            ))}
          </div>
        </section>
        <section className="px-6 pb-12">
          <div className="mx-auto w-full max-w-7xl rounded-[2rem] border border-[var(--line)] bg-white/88 p-6 shadow-[0_18px_40px_rgba(10,22,40,0.05)] backdrop-blur sm:p-8">
            <AnimatedSection>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Built for real systems</p>
              <h2 className="mt-2 font-[var(--font-space-grotesk)] text-3xl font-black tracking-[-0.05em] text-[var(--ink)]">Enterprise execution engine</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--ink-muted)]">
                Production-safe orchestration designed for operational scale.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {executionEngine.map((item, index) => (
                  <AnimatedSection key={item} delay={0.06 * index}>
                    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-4 py-4 text-sm font-semibold text-[var(--ink)] shadow-[0_8px_20px_rgba(10,22,40,0.04)]">
                      {item}
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </section>
        <section className="px-6 pb-12">
          <div className="mx-auto w-full max-w-7xl overflow-hidden rounded-[2rem] border border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(26,168,188,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(245,197,83,0.14),transparent_24%),linear-gradient(180deg,#09111d,#122033)] p-8 text-white shadow-[0_30px_80px_rgba(15,23,42,0.35)]">
            <AnimatedSection>
              <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/55">New service offers</p>
                  <h2 className="mt-3 font-[var(--font-space-grotesk)] text-3xl font-black tracking-[-0.05em] sm:text-4xl">Commercial services now fit the rest of the site.</h2>
                  <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/72">
                    We are extending the MigraTeck offer with two practical service systems: a launch-focused AI Website
                    Builder and a recurring AI Content Generator. Both create a clearer entry point for prospects and a
                    stronger ongoing service story.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-white/78">
                    Action-driven CTAs
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-white/78">
                    Managed delivery positioning
                  </div>
                </div>
              </div>
            </AnimatedSection>
            <div className="mt-8 grid gap-5 xl:grid-cols-2">
              {aiServiceOffers.map((offer, index) => (
                <AnimatedSection key={offer.title} delay={0.06 * (index + 1)}>
                  <article className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/55">{offer.badge}</p>
                    <h3 className="mt-3 text-2xl font-black tracking-tight">{offer.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-white/72">{offer.description}</p>
                    <div className="mt-6">
                      <LinkButton href={offer.href} className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 hover:bg-white/90">
                        {offer.cta}
                      </LinkButton>
                    </div>
                  </article>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>
        <section id="architecture" className="px-6 pb-24">
          <div className="mx-auto w-full max-w-7xl">
            <AnimatedSection>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Architecture overview</p>
              <h2 className="mt-2 font-[var(--font-space-grotesk)] text-3xl font-black tracking-[-0.05em] text-[var(--ink)]">Platform layers</h2>
            </AnimatedSection>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {architectureLayers.map((layer, index) => (
                <AnimatedSection key={layer.title} delay={0.06 * index}>
                  <article className="h-full rounded-[1.75rem] border border-[var(--line)] bg-white/88 p-5 shadow-[0_18px_40px_rgba(10,22,40,0.05)] backdrop-blur">
                    <h3 className="font-[var(--font-space-grotesk)] text-lg font-bold tracking-[-0.03em] text-[var(--ink)]">{layer.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{layer.description}</p>
                  </article>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter authBranding={authBranding} />
    </div>
  );
}
