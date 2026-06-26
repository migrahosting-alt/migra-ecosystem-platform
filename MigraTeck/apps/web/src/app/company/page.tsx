import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Company",
  description:
    "MigraHosting is operated by MigraTeck and focused on practical hosting, websites, email, security, and customer support.",
  path: "/company",
});

const companyHighlights = [
  {
    title: "Hosting you can actually use",
    desc: "Domains, hosting, business email, websites, and support are organized so customers can get started quickly without sorting through platform jargon.",
  },
  {
    title: "Practical support",
    desc: "We focus on setup, reliability, billing clarity, and real help when something needs attention.",
  },
  {
    title: "Built on operating discipline",
    desc: "MigraHosting is backed by MigraTeck systems for account access, billing, service operations, and long-term maintenance.",
  },
] as const;

const operatingPrinciples = [
  {
    title: "Simple buying paths",
    desc: "Visitors should be able to find a domain, choose hosting, request a website, or open the client portal without extra steps.",
  },
  {
    title: "Clear service scope",
    desc: "We describe what is included, what support covers, and when a custom service is the right fit.",
  },
  {
    title: "Stable infrastructure",
    desc: "Hosting, email, and website services are delivered with reliability, security, and maintenance in mind.",
  },
  {
    title: "Human communication",
    desc: "Billing, support, and service updates are written for customers, not for internal architecture diagrams.",
  },
] as const;

const trustPoints = [
  ["Domains", "Registration, renewals, DNS, and transfer support."],
  ["Hosting", "Managed plans built for speed, uptime, and straightforward setup."],
  ["Email", "Professional mailbox setup with secure access and support guidance."],
  ["Websites", "Launch support for business sites, landing pages, and managed updates."],
] as const;

export default function CompanyPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Company", url: absoluteUrl("/company") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-[-4rem] top-20 h-72 w-72 rounded-full bg-fuchsia-300/25 blur-[90px]" />
        <div className="pointer-events-none absolute right-[-5rem] bottom-0 h-80 w-80 rounded-full bg-orange-200/40 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="max-w-3xl">
            <p className={ui.eyebrowBrand}>About MigraHosting</p>
            <h1 className={cn(ui.h1, "mt-5 max-w-2xl")}>
              Hosting, websites, and support made simpler for growing businesses.
            </h1>
            <p className={cn(ui.body, "mt-6 max-w-2xl")}>
              MigraHosting is the public hosting and services brand operated by MigraTeck. We
              help customers register domains, launch hosting, set up business email, build
              websites, and manage everything from one straightforward client portal.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/products/migrahosting" className={ui.btnPrimary}>
                View hosting
              </Link>
              <Link href="/services" className={ui.btnSecondary}>
                Explore services
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-6 md:grid-cols-3">
            {companyHighlights.map((section, index) => (
              <div key={section.title} className={cn(ui.card, ui.cardHover, "p-6 sm:p-7")}>
                <p className={ui.eyebrow}>{`Company view 0${index + 1}`}</p>
                <h2 className={cn(ui.h3, "mt-3")}>{section.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{section.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <div className={cn(ui.cardStrong, "grid gap-10 p-8 sm:p-10 lg:grid-cols-[1.1fr_0.9fr]")}>
            <div>
              <p className={ui.eyebrowBrand}>How we operate</p>
              <h2 className={cn(ui.h2, "mt-3 max-w-xl")}>
                A practical hosting company with the systems to support long-term customers.
              </h2>
              <p className={cn(ui.body, "mt-5 max-w-2xl")}>
                MigraHosting started from infrastructure delivery and grew into a broader
                customer offering. MigraTeck remains the operating company behind the service,
                but the public experience stays focused on what customers need to buy, manage,
                and support every day.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {trustPoints.map(([title, desc]) => (
                <div key={title} className={cn(ui.cardMuted, "p-5")}>
                  <p className="text-sm font-semibold text-[var(--brand-ink)]">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Operating principles</p>
          <h2 className={cn(ui.h2, "mt-3")}>What customers should feel from the first visit.</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {operatingPrinciples.map((principle, index) => (
              <div key={principle.title} className={cn(ui.card, "p-6 sm:p-7")}>
                <span className={ui.depthNum}>{`0${index + 1}`}</span>
                <h3 className={cn(ui.h3, "mt-4")}>{principle.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{principle.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <div className={cn(ui.card, "p-8 text-center sm:p-10")}>
            <p className={ui.eyebrowBrand}>Start here</p>
            <h2 className={cn(ui.h2, "mt-3")}>Choose the path that matches what you need.</h2>
            <p className={cn(ui.body, "mx-auto mt-4 max-w-2xl")}>
              Start with hosting, request a website, or open the client portal if you already
              have services with us.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/pricing" className={ui.btnPrimary}>
                See pricing
              </Link>
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
