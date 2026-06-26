import Image from "next/image";
import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Portfolio",
  description:
    "See the MigraHosting and MigraTeck product lines, service areas, and customer-facing work that support hosting, websites, communication, and operations.",
  path: "/portfolio",
});

const portfolioHighlights = [
  {
    title: "Customer-facing products",
    description:
      "Public products, service lines, and delivery surfaces that customers can actually buy, request, or manage.",
  },
  {
    title: "Operational support",
    description:
      "Behind each public offering is a support, billing, and service model built to keep work moving after launch.",
  },
  {
    title: "Connected delivery",
    description:
      "Hosting, websites, email, communication, and account workflows stay connected instead of being split into isolated tools.",
  },
] as const;

const productLines = [
  {
    name: "MigraHosting",
    logo: "/brands/products/migrahosting.png",
    description: "Domains, hosting, business email, websites, billing, and support from one public customer path.",
    href: "/products/migrahosting",
    tag: "Hosting",
  },
  {
    name: "MigraPanel",
    logo: "/brands/products/migrapanel.png",
    description: "The client portal customers use to review services, invoices, account access, and support activity.",
    href: "/products/migrapanel",
    tag: "Portal",
  },
  {
    name: "MigraMail",
    logo: "/brands/products/migramail.png",
    description: "Mailbox and communication services that support business email and customer messaging needs.",
    href: "/products/migramail",
    tag: "Email",
  },
  {
    name: "MigraVoice",
    logo: "/brands/products/migravoice.png",
    description: "Voice and communication workflows for businesses that need a more connected customer contact layer.",
    href: "/products/migravoice",
    tag: "Communications",
  },
  {
    name: "MigraIntake",
    logo: "/brands/products/migraintake.png",
    description: "Structured request, intake, and onboarding flows that support service delivery and customer operations.",
    href: "/products/migraintake",
    tag: "Workflow",
  },
  {
    name: "MigraMarketing",
    logo: "/brands/products/migramarketing.png",
    description: "Launch and outreach support for businesses that need content, campaigns, and operational follow-through.",
    href: "/products/migramarketing",
    tag: "Growth",
  },
  {
    name: "MigraDrive",
    logo: "/brands/products/migradrive.png",
    description: "Storage and distribution services for teams that need secure file access and delivery support.",
    href: "/products/migradrive",
    tag: "Storage",
  },
  {
    name: "MigraPilot",
    logo: "/brands/products/migrapilot.png",
    description: "Operational guidance and support tooling for broader service and platform coordination.",
    href: "/products/migrapilot",
    tag: "Operations",
  },
  {
    name: "MigraInvoice",
    logo: "/brands/products/migrainvoice.png",
    description: "Billing and revenue workflows that support subscriptions, payments, and service management.",
    href: "/products/migrainvoice",
    tag: "Billing",
  },
] as const;

const workAreas = [
  {
    title: "Launch and hosting",
    desc: "Business websites, hosting setup, domains, SSL, and managed infrastructure delivery.",
  },
  {
    title: "Email and communication",
    desc: "Mailbox setup, support guidance, and connected communication services for ongoing operations.",
  },
  {
    title: "Client operations",
    desc: "Billing, account access, support handling, and service follow-through after the initial sale.",
  },
] as const;

export default function MigraTeckPortfolioPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Portfolio", url: absoluteUrl("/portfolio") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-[-5rem] top-24 h-72 w-72 rounded-full bg-fuchsia-300/30 blur-[90px]" />
        <div className="pointer-events-none absolute right-[-6rem] bottom-0 h-80 w-80 rounded-full bg-orange-200/35 blur-[105px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="max-w-3xl">
              <p className={ui.eyebrowBrand}>Portfolio</p>
              <h1 className={cn(ui.h1, "mt-5 max-w-2xl")}>
                Product lines and service work built around real hosting customers.
              </h1>
              <p className={cn(ui.body, "mt-6 max-w-2xl")}>
                This page shows the broader public-facing MigraTeck work around MigraHosting:
                customer products, operational tools, and service areas that support domains,
                hosting, websites, email, billing, and support.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/products" className={ui.btnPrimary}>
                  View products
                </Link>
                <Link href="/services" className={ui.btnSecondary}>
                  View services
                </Link>
              </div>
            </div>

            <div className={cn(ui.cardStrong, "p-6 sm:p-8")}>
              <p className={ui.eyebrowBrand}>At a glance</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {portfolioHighlights.map((item) => (
                  <div key={item.title} className={cn(ui.cardMuted, "p-4")}>
                    <p className="text-sm font-semibold text-[var(--brand-ink)]">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Product lines</p>
          <h2 className={cn(ui.h2, "mt-3")}>The public work surrounding MigraHosting.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {productLines.map((product) => (
              <Link key={product.name} href={product.href} className={cn(ui.card, ui.cardHover, "block p-6")}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={ui.logoBadgeLg}>
                      <Image src={product.logo} alt={product.name} fill sizes="56px" className="object-contain p-1" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--brand-ink)]">{product.name}</h3>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-700">
                        {product.tag}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">{product.description}</p>
                <p className="mt-5 text-sm font-semibold text-fuchsia-700">View product →</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-3">
            {workAreas.map((area, index) => (
              <div key={area.title} className={cn(ui.cardStrong, "p-6 sm:p-7")}>
                <span className={ui.depthNum}>{index + 1}</span>
                <h2 className={cn(ui.h3, "mt-4")}>{area.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{area.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <div className={cn(ui.card, "p-8 text-center sm:p-10")}>
            <p className={ui.eyebrowBrand}>Next step</p>
            <h2 className={cn(ui.h2, "mt-3")}>Start with the product or service that fits your need.</h2>
            <p className={cn(ui.body, "mx-auto mt-4 max-w-2xl")}>
              If you are comparing hosting, email, or website services, the product and pricing
              pages will get you to the right starting point fastest.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/pricing" className={ui.btnPrimary}>
                See pricing
              </Link>
              <Link href="/company" className={ui.btnSecondary}>
                Learn about the company
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
