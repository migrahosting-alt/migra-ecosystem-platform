import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { serviceInquiries } from "@/lib/inquiry";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Services",
  description:
    "Request website launch, migration support, and ongoing website help through simple MigraHosting service packages.",
  path: "/services",
});

const services = [
  {
    id: "website-launch",
    title: "Website Launch",
    desc: "A polished business website package for companies that need a stronger online presence without dragging the project out.",
    audience: "Businesses starting fresh or replacing an outdated site.",
    outcome: "A live website, connected domain, basic setup support, and a cleaner handoff into hosting and portal access.",
    inquiryHref: serviceInquiries.websiteLaunch,
    cta: "Request a website",
  },
  {
    id: "website-refresh",
    title: "Website Refresh and Updates",
    desc: "Ongoing help for content updates, section changes, landing pages, and general website cleanup after launch.",
    audience: "Teams that already have a site but need consistent updates without hiring in-house right away.",
    outcome: "A manageable support path for website improvements, copy changes, and launch follow-up work.",
    inquiryHref: serviceInquiries.aiContentGenerator,
    cta: "Request website help",
  },
  {
    id: "migration-support",
    title: "Migration and Setup Support",
    desc: "Help moving domains, hosting, or business email into a cleaner setup when your current stack feels scattered.",
    audience: "Businesses moving from another provider or consolidating multiple services.",
    outcome: "A simpler migration plan with clearer next steps for hosting, email, and account access.",
    inquiryHref: serviceInquiries.general,
    cta: "Request migration help",
  },
] as const;

const deliveryPhases = [
  {
    title: "Review the starting point",
    description: "We look at your domain, current site, email needs, and what should happen first.",
  },
  {
    title: "Build the right package",
    description: "We shape the service around launch, migration, or updates instead of forcing a one-size-fits-all path.",
  },
  {
    title: "Launch with support",
    description: "Once the service is ready, you keep a clear portal and support path for what comes next.",
  },
] as const;

const trustNotes = [
  "Website work tied to hosting and account setup",
  "Migration help when domains, hosting, or email need to move together",
  "Clear request paths instead of vague service bundles",
] as const;

export default function ServicesPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Services", url: absoluteUrl("/services") },
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
              <p className={ui.eyebrowBrand}>Services</p>
              <h1 className={cn(ui.h1, "mt-4 max-w-3xl")}>Website and migration services built around real launch needs.</h1>
              <p className={cn(ui.body, "mt-6 max-w-2xl")}>
                If you need a website, a cleaner move from another provider, or help getting the basics aligned, these are the service paths designed for that work.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="#service-cards" className={ui.btnPrimary}>
                  View service packages
                </Link>
                <Link href="/pricing" className={ui.btnSecondary}>
                  View pricing
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
          <div id="service-cards" className="grid gap-5 xl:grid-cols-3">
            {services.map((service) => (
              <div key={service.title} id={service.id} className={cn(ui.cardStrong, "flex flex-col p-6 sm:p-7")}>
                <p className={ui.eyebrowBrand}>Service package</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[var(--brand-ink)]">{service.title}</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--brand-muted)]">{service.desc}</p>
                <div className="mt-6 space-y-4 border-t border-[var(--line)] pt-6">
                  <div>
                    <p className={ui.eyebrow}>Best for</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--brand-muted)]">{service.audience}</p>
                  </div>
                  <div>
                    <p className={ui.eyebrow}>Result</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--brand-muted)]">{service.outcome}</p>
                  </div>
                </div>
                <a href={service.inquiryHref} className={cn(ui.btnPrimary, "mt-6")}>
                  {service.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>How it works</p>
              <h2 className={cn(ui.h2, "mt-3")}>A simpler service path from first request to launch.</h2>
              <p className={cn(ui.bodySmall, "mt-4 text-base")}>
                These services are meant to reduce confusion, not add more of it. The goal is to make the next step obvious.
              </p>
            </div>

            <div className="grid gap-4">
              {deliveryPhases.map((phase) => (
                <div key={phase.title} className={cn(ui.card, "p-5")}>
                  <h3 className="text-lg font-semibold text-[var(--brand-ink)]">{phase.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--brand-muted)]">{phase.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-10")}>
        <div className={ui.maxW}>
          <div className="page-glow overflow-hidden rounded-[36px] border border-white/80 bg-[linear-gradient(135deg,rgba(247,239,255,0.92),rgba(255,255,255,0.96)_52%,rgba(255,244,236,0.96))] px-6 py-10 text-center shadow-[var(--shadow-lg)] sm:px-10 sm:py-12">
            <p className={ui.eyebrowBrand}>Need a launch plan?</p>
            <h2 className={cn(ui.h2, "mt-3")}>Tell us what you need and we will scope the right service.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-[var(--brand-muted)]">
              Whether you need a new website, a migration, or ongoing help, the goal is to get you online with less friction.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={serviceInquiries.general} className={ui.btnPrimary}>
                Send inquiry
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
