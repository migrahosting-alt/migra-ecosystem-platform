import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { pricingInquiries } from "@/lib/inquiry";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "MigraTeck pricing includes fast website launch packages, recurring AI content retainers, and custom commercial scopes for broader projects.",
  path: "/pricing",
});

const websitePlans = [
  {
    title: "Starter Launch",
    price: "$599",
    detail: "Single-page conversion website delivered fast.",
    features: ["48-hour turnaround", "Mobile-first responsive design", "Domain connection support", "Basic SEO setup"],
    featured: false,
    inquiryHref: pricingInquiries.starterLaunch,
  },
  {
    title: "Business Launch",
    price: "$899",
    detail: "Multi-section site with stronger commercial framing.",
    features: ["Up to five core sections", "Business email setup", "Contact funnel wiring", "Content assistance"],
    featured: true,
    inquiryHref: pricingInquiries.businessLaunch,
  },
  {
    title: "Scale Launch",
    price: "$1,499",
    detail: "A fuller presence for businesses with more moving parts.",
    features: ["Expanded IA and copy shaping", "Lead capture and routing", "Advanced SEO structure", "Post-launch support handoff"],
    featured: false,
    inquiryHref: pricingInquiries.scaleLaunch,
  },
];

const serviceRetainers = [
  {
    title: "AI Content Engine",
    price: "$350/mo",
    description: "Recurring blogs, campaign content, landing-page support, and product copy generation.",
    inquiryHref: pricingInquiries.aiContentEngine,
  },
  {
    title: "Content Ops Plus",
    price: "$700/mo",
    description: "Higher output volume, review loops, campaign batching, and publishing coordination.",
    inquiryHref: pricingInquiries.contentOpsPlus,
  },
  {
    title: "Custom Commercial Scope",
    price: "Custom",
    description: "For mixed launch, content, and platform-positioning packages that do not fit a standard box.",
    inquiryHref: pricingInquiries.customScope,
  },
];

export default function PricingPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Pricing", url: absoluteUrl("/pricing") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-0 top-10 h-[420px] w-[420px] rounded-full bg-blue-500/15 blur-[120px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Pricing
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Straightforward launch pricing with room for larger scopes.
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-2xl text-lg leading-8 text-slate-300/90">
              MigraTeck pricing is built around practical entry points: fast launch packages
              for businesses that need a credible digital presence quickly, recurring content
              retainers for ongoing publishing, and custom scopes for broader operational work.
            </p>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-2xl text-center">
            <p className={ui.eyebrowBrand}>Website launch packages</p>
            <h2 className={cn(ui.h2, "mt-4")}>Fast commercial entry for businesses that need a credible presence now.</h2>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {websitePlans.map((plan) => (
              <div key={plan.title} className={cn(ui.card, plan.featured ? "border-blue-400/40 shadow-[0_20px_50px_rgba(37,99,235,0.2)]" : "", "flex flex-col p-7")}>
                <p className={ui.eyebrowBrand}>{plan.featured ? "Recommended" : "Launch tier"}</p>
                <h3 className={cn(ui.h3, "mt-3")}>{plan.title}</h3>
                <p className="mt-3 font-[var(--font-display)] text-4xl font-bold tracking-tight text-white">{plan.price}</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">{plan.detail}</p>
                <div className="mt-6 space-y-3 border-t border-white/10 pt-6">
                  {plan.features.map((feature) => (
                    <p key={feature} className="text-sm text-slate-300">{feature}</p>
                  ))}
                </div>
                <div className="mt-6">
                  <a
                    href={plan.inquiryHref}
                    className={cn(
                      "inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-medium transition",
                      plan.featured
                        ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400"
                        : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10",
                    )}
                  >
                    Get started
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn("border-t border-white/10", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <p className={ui.eyebrowBrand}>Recurring content</p>
              <h2 className={cn(ui.h2, "mt-4")}>Monthly content retainers for consistent publishing.</h2>
              <p className={cn(ui.body, "mt-4")}>
                These packages turn business inputs into usable marketing assets without asking clients to build an in-house writing machine first.
              </p>
            </div>
            <div className="grid gap-4">
              {serviceRetainers.map((service) => (
                <div key={service.title} className={cn(ui.card, "p-6")}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-[var(--font-display)] text-xl font-semibold tracking-tight text-white">{service.title}</h3>
                    <span className="text-lg font-semibold text-blue-400">{service.price}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{service.description}</p>
                  <div className="mt-4">
                    <a
                      href={service.inquiryHref}
                      className="text-sm font-medium text-blue-400 transition hover:text-blue-300"
                    >
                      Inquire about this plan →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Ready to move forward?</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            Email us with your project details and we will respond within one business day.
            Custom scopes, bundled packages, and platform work are all available.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={pricingInquiries.generalPricing}
              className={ui.btnPrimaryLight}
            >
              Send project inquiry
            </a>
            <Link href="/services" className={ui.btnSecondaryDark}>Review service tracks</Link>
          </div>
          <p className="mt-6 text-sm text-slate-400">Or reach us directly at <a href="mailto:services@migrateck.com" className="text-blue-400 hover:text-blue-300">services@migrateck.com</a></p>
        </div>
      </section>
    </>
  );
}