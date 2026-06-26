import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { pricingInquiries } from "@/lib/inquiry";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Preview hosting, business email, and website service pricing with clear starting points and direct next steps.",
  path: "/pricing",
});

const hostingPlans = [
  {
    title: "Starter Hosting",
    price: "From $3.99/mo",
    detail: "For new sites that need a simple, dependable place to launch.",
    features: ["Dedicated VPS entry point", "Clear upgrade path", "Client portal access", "Support when you need it"],
    cta: { label: "Choose hosting", href: "/request-access?product=migrahosting" },
    featured: false,
  },
  {
    title: "Business Hosting",
    price: "From $6.99/mo",
    detail: "For growing businesses that want more room, cleaner performance, and easier support.",
    features: ["More capacity for active sites", "Better room for business workloads", "Billing and support in one place", "Recommended starting point"],
    cta: { label: "Choose hosting", href: "/request-access?product=migrahosting" },
    featured: true,
  },
  {
    title: "Managed Launch",
    price: "Custom",
    detail: "For customers who want help choosing hosting, setup, and related services before launch.",
    features: ["Guided setup", "Domain and email coordination", "Website launch support", "Support-led onboarding"],
    cta: { label: "Request help", href: pricingInquiries.customScope },
    featured: false,
  },
] as const;

const emailPlans = [
  {
    title: "Business Email",
    price: "Get started",
    description: "Start branded email with your own domain and one account path for support and setup.",
    href: "/products/migramail",
  },
  {
    title: "Mailbox Setup Help",
    price: "Included support path",
    description: "Use the setup help page when you need to connect desktop, mobile, or custom mail clients.",
    href: "/support/elize-foundation-mail",
  },
  {
    title: "Email + Hosting",
    price: "Bundle your basics",
    description: "Pair hosting and business email so your website, portal, and branded inboxes start together.",
    href: "/products/migrahosting",
  },
] as const;

const websiteServices = [
  {
    title: "Starter Launch",
    price: "$599",
    detail: "A fast single-page business site with the basics covered.",
    features: ["48-hour turnaround", "Mobile-ready design", "Domain connection support", "Basic SEO setup"],
    inquiryHref: pricingInquiries.starterLaunch,
    featured: false,
  },
  {
    title: "Business Launch",
    price: "$899",
    detail: "A stronger website package for businesses that need more sections and clearer service framing.",
    features: ["Up to five sections", "Business email setup", "Contact funnel wiring", "Content assistance"],
    inquiryHref: pricingInquiries.businessLaunch,
    featured: true,
  },
  {
    title: "Scale Launch",
    price: "$1,499",
    detail: "For fuller launches with more content, more structure, and more support around the rollout.",
    features: ["Expanded structure", "Lead capture setup", "Advanced SEO support", "Post-launch handoff"],
    inquiryHref: pricingInquiries.scaleLaunch,
    featured: false,
  },
] as const;

const trustNotes = [
  "Start with one product or service instead of committing to everything at once",
  "Use the client portal for billing, account access, and support after signup",
  "Request help first if you are not sure which plan fits your situation",
] as const;

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

      <section className="hero-gradient hero-mesh relative overflow-hidden px-5 pb-14 pt-10 sm:px-6 sm:pb-16">
        <div className="gradient-orb gradient-orb-violet left-[-3rem] top-16 h-40 w-40 sm:h-52 sm:w-52" />
        <div className="gradient-orb gradient-orb-peach right-[-2rem] top-4 h-36 w-36 sm:h-44 sm:w-44" />
        <div className={cn(ui.maxW, "relative")}>
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className={ui.eyebrowBrand}>Pricing</p>
              <h1 className={cn(ui.h1, "mt-4 max-w-3xl")}>Clear starting points for hosting, email, and website services.</h1>
              <p className={cn(ui.body, "mt-6 max-w-2xl")}>
                Start with the service you need first. Hosting, business email, and website packages each have a direct next step instead of a maze of add-ons.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/request-access?product=migrahosting" className={ui.btnPrimary}>
                  Choose hosting
                </Link>
                <Link href="/products/migramail" className={ui.btnSecondary}>
                  Get business email
                </Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {trustNotes.map((note, index) => (
                <div key={note} className={cn(ui.cardStrong, "p-5")}>
                  <div className={ui.depthNum}>{index + 1}</div>
                  <p className="mt-4 text-sm leading-7 text-[var(--brand-muted)]">{note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-3xl text-center">
            <p className={ui.eyebrowBrand}>Hosting</p>
            <h2 className={cn(ui.h2, "mt-3")}>Hosting plans that get businesses online without the usual clutter.</h2>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {hostingPlans.map((plan) => (
              <div
                key={plan.title}
                className={cn(
                  ui.cardStrong,
                  "flex flex-col p-6 sm:p-7",
                  plan.featured ? "ring-1 ring-[var(--line-strong)] shadow-[0_26px_60px_rgba(124,58,237,0.14)]" : "",
                )}
              >
                <p className={ui.eyebrowBrand}>{plan.featured ? "Recommended" : "Hosting plan"}</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[var(--brand-ink)]">{plan.title}</h3>
                <p className="mt-3 font-[var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--brand-ink)]">{plan.price}</p>
                <p className="mt-3 text-sm leading-6 text-[var(--brand-muted)]">{plan.detail}</p>
                <div className="mt-6 space-y-3 border-t border-[var(--line)] pt-6">
                  {plan.features.map((feature) => (
                    <p key={feature} className="text-sm text-[var(--brand-muted)]">{feature}</p>
                  ))}
                </div>
                <Link href={plan.cta.href} className={cn(ui.btnPrimary, "mt-6")}>
                  {plan.cta.label}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>Business email</p>
              <h2 className={cn(ui.h2, "mt-3")}>Email options for businesses that want a cleaner, more professional setup.</h2>
              <p className={cn(ui.bodySmall, "mt-4 text-base")}>
                If your website and email are launching together, this is the easiest place to keep the basics aligned.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {emailPlans.map((plan) => (
                <Link key={plan.title} href={plan.href} className={cn(ui.card, ui.cardHover, "p-5")}>
                  <p className={ui.eyebrowBrand}>{plan.price}</p>
                  <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-[var(--brand-ink)]">{plan.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-[var(--brand-muted)]">{plan.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-3xl text-center">
            <p className={ui.eyebrowBrand}>Website services</p>
            <h2 className={cn(ui.h2, "mt-3")}>Website packages for businesses that want a real launch, not filler.</h2>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {websiteServices.map((plan) => (
              <div
                key={plan.title}
                className={cn(
                  ui.card,
                  "flex flex-col p-6 sm:p-7",
                  plan.featured ? "ring-1 ring-[var(--line-strong)] shadow-[0_26px_60px_rgba(124,58,237,0.12)]" : "",
                )}
              >
                <p className={ui.eyebrowBrand}>{plan.featured ? "Popular website package" : "Website package"}</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[var(--brand-ink)]">{plan.title}</h3>
                <p className="mt-3 font-[var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--brand-ink)]">{plan.price}</p>
                <p className="mt-3 text-sm leading-6 text-[var(--brand-muted)]">{plan.detail}</p>
                <div className="mt-6 space-y-3 border-t border-[var(--line)] pt-6">
                  {plan.features.map((feature) => (
                    <p key={feature} className="text-sm text-[var(--brand-muted)]">{feature}</p>
                  ))}
                </div>
                <a href={plan.inquiryHref} className={cn(ui.btnSecondary, "mt-6")}>
                  Request a website
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-10")}>
        <div className={ui.maxW}>
          <div className="page-glow overflow-hidden rounded-[36px] border border-white/80 bg-[linear-gradient(135deg,rgba(247,239,255,0.92),rgba(255,255,255,0.96)_52%,rgba(255,244,236,0.96))] px-6 py-10 text-center shadow-[var(--shadow-lg)] sm:px-10 sm:py-12">
            <p className={ui.eyebrowBrand}>Need help choosing?</p>
            <h2 className={cn(ui.h2, "mt-3")}>Tell us what you need and we will point you to the right starting place.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-[var(--brand-muted)]">
              Hosting, business email, and website services can be started separately or combined into one cleaner launch.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={pricingInquiries.generalPricing} className={ui.btnPrimary}>
                Send project inquiry
              </a>
              <Link href="/login" className={ui.btnSecondary}>
                Open client portal
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
