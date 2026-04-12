import type { Metadata } from "next";
import { AnimatedSection } from "@/components/marketing/animated-section";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { LinkButton } from "@/components/ui/button";

const serviceHighlights = [
  "Custom website live in 48 hours",
  "Domain plus business email included",
  "SEO-ready launch support from day one",
];

export const metadata: Metadata = {
  title: "Website Live in 48 Hours",
  description:
    "Launch a premium business website in 48 hours with MigraHosting. Custom design, domain setup, business email, and SEO-ready delivery included.",
  alternates: {
    canonical: "https://migrahosting.com/services",
  },
  openGraph: {
    title: "Your Website. Live in 48 Hours.",
    description:
      "Custom design, domain setup, business email, and SEO-ready launch support from MigraHosting.",
    url: "https://migrahosting.com/services",
    images: [
      {
        url: "https://migrahosting.com/content/marketing/assets/website_48h_launch/landscape/website-offer-landscape-v1.svg",
        width: 1200,
        height: 628,
        alt: "MigraHosting website launch campaign artwork",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Your Website. Live in 48 Hours.",
    description:
      "Custom design, domain setup, business email, and SEO-ready launch support from MigraHosting.",
    images: ["https://migrahosting.com/content/marketing/assets/website_48h_launch/landscape/website-offer-landscape-v1.svg"],
  },
};

const aiServices = [
  {
    slug: "website-launch-48h",
    eyebrow: "Priority Launch Offer",
    title: "48-Hour Website Launch",
    description: "A premium small-business website offer built to go live fast without looking rushed or generic.",
    priceLabel: "$199 launch package",
    accentClass:
      "border-[var(--line)] bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(30,41,59,0.9))] text-white",
    buttonClass:
      "bg-white text-slate-950 hover:bg-white/90",
    features: [
      "Custom launch layout tailored to the business offer",
      "Domain connection and professional business email setup",
      "Responsive design for desktop, tablet, and mobile launch",
      "SEO-ready structure, metadata, and conversion-focused copy",
      "Managed MigraHosting handoff for updates and expansion",
    ],
    outcome:
      "Best for businesses that need a credible web presence immediately and want one offer that covers the essentials.",
  },
  {
    slug: "ai-content-generator",
    eyebrow: "Most Popular",
    title: "AI Content Generator",
    description: "Recurring content operations for blogs, product copy, landing pages, emails, and campaigns.",
    priceLabel: "Managed monthly content service",
    accentClass:
      "border-fuchsia-500/50 bg-[linear-gradient(180deg,rgba(36,22,56,0.98),rgba(20,23,42,0.96))] text-white shadow-[0_0_40px_rgba(168,85,247,0.14)]",
    buttonClass:
      "bg-[linear-gradient(90deg,#6d5efc,#f45b86)] text-white hover:opacity-95",
    features: [
      "Blog post generation with editorial structure and brand direction",
      "Product descriptions and landing page section copy",
      "Email and newsletter draft generation for campaigns",
      "Social captions and content repurposing workflows",
      "SEO optimization prompts, revision loops, and publishing queues",
    ],
    outcome:
      "Best for clients who need consistent publishing velocity and want MigraTeck to turn business inputs into usable marketing assets.",
  },
];

const deliveryPhases = [
  {
    title: "Phase 1: Intake and brand setup",
    description:
      "Collect business context, tone, offers, ICP, target keywords, preferred layouts, and publishing goals.",
  },
  {
    title: "Phase 2: Guided generation engine",
    description:
      "Turn structured prompts and reusable templates into website sections, page drafts, and reusable content assets.",
  },
  {
    title: "Phase 3: Human review and fulfillment",
    description:
      "Route outputs through MigraTeck review, approval, edits, and publish-ready packaging before clients see final delivery.",
  },
  {
    title: "Phase 4: Client dashboard integration",
    description:
      "Expose generation requests, approval states, revisions, and delivery history inside the broader MigraTeck ecosystem.",
  },
];

export default function ServicesPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Services"
        title="Commercial offers with a stronger pitch and a cleaner frame."
        description="MigraHosting now leads with a premium launch offer for businesses that need a real site fast, while keeping recurring AI content operations visible as a second growth service."
        actions={[
          { href: "#service-cards", label: "View service packages" },
          { href: "/request-access", label: "Launch today", variant: "secondary" },
        ]}
        stats={[
          { label: "Flagship offer", value: "48h" },
          { label: "Service tracks", value: String(aiServices.length) },
          { label: "Positioning", value: "Commercial", detail: "Built to convert, then expand." },
        ]}
        aside={
          <div className="grid gap-3">
            {serviceHighlights.map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-medium text-white/80">
                {item}
              </div>
            ))}
          </div>
        }
      />

      <section className="px-6 pb-16">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">

        <div id="service-cards" className="grid gap-6 xl:grid-cols-2">
          {aiServices.map((service, index) => (
            <AnimatedSection key={service.slug} delay={0.06 * (index + 1)}>
              <article
                id={service.slug}
                className={`flex h-full flex-col rounded-[2rem] border p-8 ${service.accentClass}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/70">{service.eyebrow}</p>
                    <h2 className="mt-4 text-3xl font-black tracking-tight">{service.title}</h2>
                    <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/72">{service.description}</p>
                  </div>
                </div>
                <div className="mt-8">
                  <div className="text-4xl font-black tracking-tight">{service.priceLabel}</div>
                </div>
                <ul className="mt-8 space-y-4 text-base text-white/86">
                  {service.features.map((feature) => (
                    <li key={feature} className="flex gap-3">
                      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-8 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-sm leading-relaxed text-white/76">
                  {service.outcome}
                </p>
                <div className="mt-auto pt-8">
                  <LinkButton href="/request-access" className={`w-full justify-center rounded-2xl py-3 text-base font-bold ${service.buttonClass}`}>
                    Start This Service
                  </LinkButton>
                </div>
              </article>
            </AnimatedSection>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <AnimatedSection delay={0.18}>
            <div className="rounded-[2rem] border border-[var(--line)] bg-white p-8 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">Why This Matters</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-[var(--ink)]">The page now supports a real launch offer.</h2>
              <p className="mt-4 text-base leading-relaxed text-[var(--ink-muted)]">
                The goal is simple: when someone clicks from a social campaign, the landing page should confirm the same
                promise they already saw in the creative. That means faster trust, stronger conversion intent, and less
                confusion between websites, hosting, and broader product offers.
              </p>
              <div className="mt-6 grid gap-3">
                <div className="rounded-2xl bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-muted)]">
                  The 48-hour launch package gives MigraHosting a clear entry offer that is easy to understand.
                </div>
                <div className="rounded-2xl bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-muted)]">
                  Domain setup, business email, and SEO-ready delivery make the offer feel complete instead of thin.
                </div>
                <div className="rounded-2xl bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-muted)]">
                  The same page can still support broader managed services after the launch offer closes the first sale.
                </div>
              </div>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={0.24}>
            <div className="rounded-[2rem] border border-[var(--line)] bg-white p-8 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">System Build Path</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-[var(--ink)]">Recommended delivery phases</h2>
              <div className="mt-6 space-y-4">
                {deliveryPhases.map((phase) => (
                  <div key={phase.title} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-5 py-5">
                    <h3 className="text-lg font-bold text-[var(--ink)]">{phase.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{phase.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </AnimatedSection>
        </div>
      </div>
      </section>
    </>
  );
}
