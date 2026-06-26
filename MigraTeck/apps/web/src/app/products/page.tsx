import Link from "next/link";
import Image from "next/image";
import { products } from "@/data/products";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Products",
  description:
    "Choose domains, hosting, business email, websites, security, and client access through a simpler MigraHosting product catalog.",
  path: "/products",
});

const priorityFlows = [
  {
    title: "Domains",
    description: "Start with the name your business needs and connect it to hosting, email, and your website.",
    href: "/products/migrahosting",
    cta: "Start with a domain",
  },
  {
    title: "Hosting",
    description: "Choose hosting plans built for clean launches, reliable uptime, and easier growth.",
    href: "/products/migrahosting",
    cta: "Choose hosting",
  },
  {
    title: "Business Email",
    description: "Set up branded inboxes that match your domain and keep everyday communication professional.",
    href: "/products/migramail",
    cta: "Get business email",
  },
  {
    title: "Websites",
    description: "Request a business website package when you want a real launch instead of a patchwork setup.",
    href: "/services",
    cta: "Request a website",
  },
  {
    title: "Security",
    description: "Review the safeguards around sign-in, billing, and account protection before you buy.",
    href: "/security",
    cta: "Review security",
  },
  {
    title: "Client Portal",
    description: "Open the portal to manage services, invoices, and support after signup.",
    href: "/login",
    cta: "Open client portal",
  },
] as const;

const trustNotes = [
  "Clear product entry points instead of vague bundles",
  "Simple sign-in, billing, and support paths",
  "Hosting, email, and websites that can be bought or requested quickly",
] as const;

const catalogProducts = products.filter((product) => product.slug !== "migrateck");
const infrastructureProducts = catalogProducts.filter((product) =>
  ["migrahosting", "migramail", "migrapanel", "migradrive"].includes(product.slug),
);
const supportingProducts = catalogProducts.filter((product) =>
  !["migrahosting", "migramail", "migrapanel", "migradrive"].includes(product.slug),
);

export default function ProductsPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "MigraHosting Products",
    numberOfItems: catalogProducts.length,
    itemListElement: catalogProducts.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: product.name,
      url: absoluteUrl(`/products/${product.slug}`),
    })),
  };

  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Products", url: absoluteUrl("/products") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden px-5 pb-14 pt-10 sm:px-6 sm:pb-16">
        <div className="gradient-orb gradient-orb-violet left-[-3rem] top-20 h-40 w-40 sm:h-52 sm:w-52" />
        <div className="gradient-orb gradient-orb-peach right-[-2rem] top-4 h-36 w-36 sm:h-44 sm:w-44" />
        <div className={cn(ui.maxW, "relative")}>
          <div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
            <div>
              <p className={ui.eyebrowBrand}>Products</p>
              <h1 className={cn(ui.h1, "mt-4 max-w-3xl")}>
                Pick what you need first, then add the rest when you are ready.
              </h1>
              <p className={cn(ui.body, "mt-6 max-w-2xl")}>
                Start with hosting, a domain, business email, or a website package. Every next step should feel clear, not buried under platform language.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/products/migrahosting" className={ui.btnPrimary}>
                  Choose hosting
                </Link>
                <Link href="/pricing" className={ui.btnSecondary}>
                  View pricing
                </Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {trustNotes.map((note, index) => (
                <div key={note} className={cn(ui.cardStrong, "p-5")}>
                  <div className={ui.depthNum}>{index + 1}</div>
                  <p className="mt-4 text-sm leading-7 text-[var(--brand-muted)]">{note}</p>
                </div>
              ))}
              <div className={cn(ui.cardStrong, "p-5 sm:col-span-2")}>
                <p className={ui.eyebrowBrand}>Quick path</p>
                <p className="mt-3 text-lg font-semibold tracking-[-0.03em] text-[var(--brand-ink)]">
                  Domains, hosting, business email, websites, security, and one client portal.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-3xl text-center">
            <p className={ui.eyebrowBrand}>Priority buying flows</p>
            <h2 className={cn(ui.h2, "mt-3")}>Start with the essentials.</h2>
            <p className={cn(ui.bodySmall, "mx-auto mt-4 max-w-2xl text-base")}>
              These are the pages most visitors need first when they are choosing a hosting company.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {priorityFlows.map((flow) => (
              <Link key={flow.title} href={flow.href} className={cn(ui.card, ui.cardHover, "flex flex-col p-6 sm:p-7")}>
                <p className={ui.eyebrowBrand}>{flow.title}</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[var(--brand-ink)]">{flow.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-[var(--brand-muted)]">{flow.description}</p>
                <p className="mt-5 text-sm font-semibold text-[var(--brand-violet)]">{flow.cta}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className={ui.eyebrowBrand}>Core catalog</p>
              <h2 className={cn(ui.h2, "mt-3")}>Products most closely tied to buying and managing service.</h2>
            </div>
            <span className={ui.pill}>{infrastructureProducts.length} core products</span>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {infrastructureProducts.map((product) => (
              <Link key={product.slug} href={`/products/${product.slug}`} className={cn(ui.cardStrong, ui.cardHover, "flex gap-4 p-6")}>
                <div className={ui.logoBadgeLg}>
                  <Image src={product.logo} alt={product.name} fill sizes="56px" className="object-contain" />
                </div>
                <div className="min-w-0">
                  <p className={ui.eyebrowBrand}>{product.tagline}</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--brand-ink)]">{product.name}</h3>
                  <p className="mt-3 text-sm leading-7 text-[var(--brand-muted)]">{product.shortDescription}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {product.capabilities.slice(0, 2).map((capability) => (
                      <span key={capability} className={ui.pill}>
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>More products</p>
              <h2 className={cn(ui.h2, "mt-3")}>Additional tools around communication, automation, and operations.</h2>
              <p className={cn(ui.bodySmall, "mt-4 text-base")}>
                If you need more than hosting and email, these products extend the same account, billing, and support story.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href="/services" className={ui.btnSecondary}>
                  Request a website
                </Link>
                <Link href="/login" className={ui.btnGhost}>
                  Open client portal
                </Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {supportingProducts.map((product) => (
                <Link key={product.slug} href={`/products/${product.slug}`} className={cn(ui.card, ui.cardHover, "p-5")}>
                  <div className="flex items-center gap-3">
                    <div className={ui.logoBadge}>
                      <Image src={product.logo} alt={product.name} fill sizes="44px" className="object-contain" />
                    </div>
                    <p className="font-semibold text-[var(--brand-ink)]">{product.name}</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--brand-muted)]">{product.shortDescription}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-10")}>
        <div className={ui.maxW}>
          <div className="page-glow overflow-hidden rounded-[36px] border border-white/80 bg-[linear-gradient(135deg,rgba(247,239,255,0.92),rgba(255,255,255,0.96)_52%,rgba(255,244,236,0.96))] px-6 py-10 text-center shadow-[var(--shadow-lg)] sm:px-10 sm:py-12">
            <p className={ui.eyebrowBrand}>Ready to choose</p>
            <h2 className={cn(ui.h2, "mt-3")}>Choose the product that gets you online fastest.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-[var(--brand-muted)]">
              Start with hosting, add email, request a website, and use the client portal to keep billing and support in one place.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/products/migrahosting" className={ui.btnPrimary}>
                Choose hosting
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
