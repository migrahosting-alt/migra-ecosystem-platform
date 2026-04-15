import Link from "next/link";
import Image from "next/image";
import { products, featuredProducts } from "@/data/products";
import { getAccountLinks } from "@/lib/account-links";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";
import MigraTeckHero from "@/components/marketing/hero";

const pillars = [
  { title: "Enterprise governance layer", desc: "Policy controls, organization boundaries, risk-tier enforcement, and auditable access decisions." },
  { title: "Developer-capable platform", desc: "API-ready foundations with deterministic workflows, product routing, and extensible service contracts." },
  { title: "Infrastructure orchestration core", desc: "Signed job execution, replay-safe queues, and deterministic workflow behavior across provisioning flows." },
  { title: "Product launch surface", desc: "Entitlement-aware distribution for products, downloads, and launches through centralized organization context." },
] as const;

const executionEngine = [
  "Tier-aware access control",
  "Signed workflow execution",
  "Deterministic provisioning",
  "Shared identity context",
  "Verified distribution channels",
] as const;

const architectureLayers = [
  { title: "Identity layer", desc: "Sessions, organization context, and account trust boundaries." },
  { title: "Governance layer", desc: "RBAC, policies, entitlement checks, and mutation control." },
  { title: "Execution layer", desc: "Provisioning, automation, and platform-managed workflow execution." },
  { title: "Distribution layer", desc: "Downloads, release channels, and verified artifact delivery." },
  { title: "Commercial layer", desc: "Products, services, pricing, and portfolio surfaces aligned to one story." },
] as const;

const serviceOffers = [
  {
    title: "48-Hour Website Launch",
    description: "A fast commercial entry offer for clients who need a real website, business email, and launch support without a generic template feel.",
    href: "/services#website-launch-48h",
    badge: "Launch offer",
  },
  {
    title: "AI Content Generator",
    description: "Recurring content operations for blogs, landing pages, product copy, email campaigns, and managed publishing workflows.",
    href: "/services#ai-content-generator",
    badge: "Recurring service",
  },
] as const;

export default function HomePage() {
  const accountLinks = getAccountLinks();

  return (
    <>
      <MigraTeckHero />

      <section className="relative -mt-4 pb-20 pt-4">
        <div className={ui.maxW}>
          <p className="text-center text-sm font-medium text-slate-500">
            {products.length} products spanning the entire platform
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {products.map((product) => (
              <Link
                key={product.key}
                href={`/products/${product.slug}`}
                className={cn(
                  ui.card,
                  "flex items-center gap-3 px-4 py-3 transition-all duration-200 hover:border-slate-300 hover:shadow-md",
                )}
              >
                <div className="relative h-8 w-8">
                  <Image src={product.logo} alt={product.name} fill sizes="32px" className="object-contain" />
                </div>
                <span className="text-sm font-medium text-slate-700">{product.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-2xl text-center">
            <p className={ui.eyebrowBrand}>Platform architecture</p>
            <h2 className={cn(ui.h2, "mt-4")}>Five platform pillars, one sharper public site.</h2>
            <p className={cn(ui.body, "mt-4")}>
              The public experience now lines up products, services, pricing, and developer entry around the same core platform model.
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {pillars.map((pillar, index) => (
              <div key={pillar.title} className={cn(ui.card, ui.cardHover, "p-6")}>
                <div className={ui.depthNum}>{index + 1}</div>
                <h3 className="mt-4 font-[var(--font-display)] text-lg font-semibold tracking-tight text-slate-950">
                  {pillar.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{pillar.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link href="/platform" className={ui.btnPrimary}>
              View full architecture
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 top-0 h-[500px] w-[400px] rounded-full bg-blue-600/15 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[300px] rounded-full bg-cyan-500/10 blur-[80px]" />

        <div className={cn(ui.maxW, "relative py-24 sm:py-32")}>
          <div className="flex items-end justify-between gap-6">
            <div>
              <p className={ui.eyebrowDark}>Execution engine</p>
              <h2 className={cn(ui.h2Dark, "mt-4")}>Production-safe systems, explained clearly.</h2>
              <p className={cn(ui.bodyDark, "mt-4 max-w-xl")}>
                The site should communicate the platform as an operating system, not a loose set of product pages.
              </p>
            </div>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {executionEngine.map((item) => (
              <div key={item} className={cn(ui.cardDark, "p-5 text-center text-sm font-semibold text-white")}>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className={ui.eyebrowBrand}>Commercial service tracks</p>
              <h2 className={cn(ui.h2, "mt-4")}>New offers that fit the same platform story.</h2>
              <p className={cn(ui.body, "mt-4")}>
                MigraTeck now presents launch services and recurring content operations as deliberate commercial entry points instead of disconnected side offers.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {serviceOffers.map((offer) => (
                <Link key={offer.title} href={offer.href} className={cn(ui.card, ui.cardHover, "block p-6")}>
                  <p className={ui.eyebrowBrand}>{offer.badge}</p>
                  <h3 className={cn(ui.h3, "mt-3")}>{offer.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{offer.description}</p>
                  <p className="mt-5 text-sm font-semibold text-blue-600">Explore service →</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Architecture overview</p>
          <h2 className={cn(ui.h2, "mt-4")}>Platform layers that explain how the business works.</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-5">
            {architectureLayers.map((layer) => (
              <div key={layer.title} className={cn(ui.card, "p-6")}>
                <h3 className="font-[var(--font-display)] text-lg font-semibold tracking-tight text-slate-950">{layer.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{layer.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>The flagship products.</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            Core products now sit inside a clearer public shell with pricing, services, developer context, and launch positioning aligned.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featuredProducts.map((product) => (
              <Link key={product.key} href={`/products/${product.slug}`} className={cn(ui.cardDark, ui.cardDarkHover, "group block p-6 text-left")}>
                <div className="flex items-center gap-3">
                  <div className={cn(ui.logoBadgeDark, "overflow-hidden")}>
                    <Image src={product.logo} alt={product.name} fill sizes="40px" className="object-contain p-1" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{product.name}</h3>
                    <p className="text-xs text-slate-500">{product.category.replace(/-/g, " ")}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-400">{product.shortDescription}</p>
                <p className="mt-4 text-sm font-medium text-sky-400 opacity-0 transition-opacity group-hover:opacity-100">View product →</p>
              </Link>
            ))}
          </div>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/products" className={ui.btnPrimaryLight}>All products</Link>
            <Link href={accountLinks.signup} className={ui.btnSecondaryDark}>Create account</Link>
          </div>
        </div>
      </section>
    </>
  );
}
