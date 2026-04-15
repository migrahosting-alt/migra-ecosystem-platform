import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Public commercial pricing for MigraTeck launch services and platform entry offers.",
  path: "/pricing",
});

const websitePlans = [
  {
    title: "Starter Launch",
    price: "$599",
    detail: "Single-page conversion website delivered fast.",
    features: ["48-hour turnaround", "Mobile-first responsive design", "Domain connection support", "Basic SEO setup"],
    featured: false,
  },
  {
    title: "Business Launch",
    price: "$899",
    detail: "Multi-section site with stronger commercial framing.",
    features: ["Up to five core sections", "Business email setup", "Contact funnel wiring", "Content assistance"],
    featured: true,
  },
  {
    title: "Scale Launch",
    price: "$1,499",
    detail: "A fuller presence for businesses with more moving parts.",
    features: ["Expanded IA and copy shaping", "Lead capture and routing", "Advanced SEO structure", "Post-launch support handoff"],
    featured: false,
  },
] as const;

const serviceRetainers = [
  {
    title: "AI Content Engine",
    price: "$350/mo",
    description: "Recurring blogs, campaign content, landing-page support, and product copy generation.",
  },
  {
    title: "Content Ops Plus",
    price: "$700/mo",
    description: "Higher output volume, review loops, campaign batching, and publishing coordination.",
  },
  {
    title: "Custom Commercial Scope",
    price: "Custom",
    description: "For mixed launch, content, and platform-positioning packages that do not fit a standard box.",
  },
] as const;

export default function PricingPage() {
  return (
    <>
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
              The public site now has a clear commercial path: fast launch packages,
              recurring AI content retainers, and a visible route into custom work.
            </p>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-2xl text-center">
            <p className={ui.eyebrowBrand}>Website launch packages</p>
            <h2 className={cn(ui.h2, "mt-4")}>Fast commercial entry for businesses that need to look legitimate now.</h2>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {websitePlans.map((plan) => (
              <div key={plan.title} className={cn(ui.card, plan.featured ? "border-blue-300 shadow-[0_20px_50px_rgba(37,99,235,0.12)]" : "", "flex flex-col p-7")}>
                <p className={ui.eyebrowBrand}>{plan.featured ? "Recommended" : "Launch tier"}</p>
                <h3 className={cn(ui.h3, "mt-3")}>{plan.title}</h3>
                <p className="mt-3 font-[var(--font-display)] text-4xl font-bold tracking-tight text-slate-950">{plan.price}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">{plan.detail}</p>
                <div className="mt-6 space-y-3 border-t border-slate-100 pt-6">
                  {plan.features.map((feature) => (
                    <p key={feature} className="text-sm text-slate-700">{feature}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
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
                    <h3 className="font-[var(--font-display)] text-xl font-semibold tracking-tight text-slate-950">{service.title}</h3>
                    <span className="text-lg font-semibold text-blue-600">{service.price}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{service.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Need a larger scope?</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            Custom projects can combine website launch, recurring content, platform positioning, and downstream product integration.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/services" className={ui.btnPrimaryLight}>Review service tracks</Link>
            <Link href="/company" className={ui.btnSecondaryDark}>Company overview</Link>
          </div>
        </div>
      </section>
    </>
  );
}