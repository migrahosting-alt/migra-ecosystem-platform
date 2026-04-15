import Link from "next/link";
import Image from "next/image";
import { products, featuredProducts } from "@/data/products";
import { getAccountLinks } from "@/lib/account-links";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";
import MigraTeckHero from "@/components/marketing/hero";

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
