import Link from "next/link";
import Image from "next/image";
import { products, featuredProducts } from "@/data/products";
import { getAccountLinks } from "@/lib/account-links";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

const stats = [
  { value: "10", label: "Official products" },
  { value: "5", label: "Architecture layers" },
  { value: "1", label: "Unified platform" },
] as const;

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

const heroReadout = [
  {
    label: "Access model",
    title: "One front door into products and accounts",
    value: "Discovery, login, signup, and product entry all feel like parts of one coordinated system.",
  },
  {
    label: "Platform model",
    title: "Commercial pages stay tied to real control",
    value: "Pricing, services, access, and launch routes all point back to the same platform backbone.",
  },
  {
    label: "Buyer signal",
    title: "The company reads as organized and credible",
    value: "The first fold now communicates trust, scope, and direction instead of disconnected marketing fragments.",
  },
] as const;

const heroReadoutStats = [
  ["Entry", "Products and pricing paths"],
  ["Control", "Identity and access flow"],
  ["Outcome", "Account-ready buyer journey"],
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
      <section className="hero-gradient hero-mesh hero-system relative -mt-28 overflow-hidden pt-24 sm:-mt-32 sm:pt-28 lg:-mt-36 lg:pt-32">
        <div className="pointer-events-none absolute -left-40 top-16 h-[600px] w-[600px] rounded-full bg-blue-500/20 blur-[120px] animate-glow-pulse" />
        <div className="pointer-events-none absolute -right-32 top-24 h-[500px] w-[500px] rounded-full bg-cyan-400/15 blur-[100px] animate-glow-pulse" style={{ animationDelay: "2s" }} />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-[300px] w-[400px] rounded-full bg-pink-500/10 blur-[80px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),transparent)]" />

        <div className={cn(ui.maxW, "relative pb-24 pt-24 sm:pb-32 sm:pt-28 lg:pb-40 lg:pt-32")}>
          <div className="hero-toprail animate-fade-in mb-8 rounded-[28px] border border-white/14 bg-white/[0.06] p-3 backdrop-blur-xl sm:p-4">
            <div className="grid gap-3 text-white/88 sm:grid-cols-[1.2fr_0.8fr] sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-100">
                  Unified front door
                </span>
                <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white/78">
                  Products, pricing, services, identity
                </span>
              </div>
              <div className="grid gap-2 text-xs font-medium uppercase tracking-[0.18em] text-white/64 sm:grid-cols-3 sm:text-right">
                <span>Route clarity</span>
                <span>Enterprise polish</span>
                <span>Live deployment path</span>
              </div>
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-[1.08fr_0.92fr] md:items-center lg:gap-10">
            <div>
              <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
                Enterprise control plane
              </p>
              <h1 className="animate-fade-up-d1 mt-6 max-w-[11ch] font-[var(--font-display)] text-5xl font-bold tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
                The public surface for products, access, and launch control.
              </h1>
              <p className="animate-fade-up-d2 mt-6 max-w-2xl text-lg leading-8 text-slate-300/90">
                MigraTeck connects identity, governance, product access, pricing, services,
                and software distribution into one coordinated front door for the ecosystem.
              </p>
              <div className="animate-fade-up-d2 mt-6 grid max-w-2xl gap-3 sm:grid-cols-3">
                {[
                  ["Trust layer", "Sticky control rail with product-aware access paths"],
                  ["Commercial layer", "Pricing, services, and portfolio aligned from the first fold"],
                  ["Launch layer", "Sharper routing into products, downloads, and enterprise pages"],
                ].map(([title, copy]) => (
                  <div key={title} className="rounded-[22px] border border-white/10 bg-white/[0.06] px-4 py-4 backdrop-blur-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200/88">{title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-200/86">{copy}</p>
                  </div>
                ))}
              </div>
              <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-4">
                <Link href="/products" className={ui.btnPrimaryLight}>
                  Browse products
                  <span aria-hidden="true">→</span>
                </Link>
                <Link href="/platform" className={ui.btnSecondaryDark}>
                  Explore architecture
                </Link>
              </div>
              <div className="animate-fade-up-d4 mt-10 flex max-w-xl divide-x divide-white/10 rounded-[26px] border border-white/10 bg-white/[0.04] px-2 py-3 text-center backdrop-blur-sm">
                {stats.map((s) => (
                  <div key={s.label} className="flex-1 px-4 first:pl-0 last:pr-0">
                    <p className="font-[var(--font-display)] text-3xl font-bold text-white sm:text-4xl">
                      {s.value}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="hero-side-panel animate-fade-up-d2 relative overflow-hidden rounded-[2rem] border border-white/12 bg-white/[0.08] p-6 backdrop-blur-xl sm:p-7">
              <div className="pointer-events-none absolute -right-20 top-0 h-44 w-44 rounded-full bg-sky-300/10 blur-3xl" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-100/90">Executive readout</p>
                  <h2 className="mt-3 max-w-[14ch] font-[var(--font-display)] text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-white sm:text-[2.25rem]">
                    What this first screen tells a serious buyer.
                  </h2>
                </div>
                <span className="rounded-full border border-white/12 bg-white/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  Board view
                </span>
              </div>
              <div className="mt-5 rounded-[1.55rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <p className="text-sm leading-6 text-slate-200/90">
                  The homepage should explain the business in one glance: where people enter, what the platform controls, and why the whole experience feels unified.
                </p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {heroReadoutStats.map(([label, value], index) => (
                  <div
                    key={label}
                    className={cn(
                      "rounded-[1.2rem] border border-white/10 bg-white/[0.05] px-4 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                      index === heroReadoutStats.length - 1 ? "sm:col-span-2" : "",
                    )}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-white">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 space-y-3.5">
                {heroReadout.map((item, index) => (
                  <div
                    key={item.label}
                    className="rounded-[1.45rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-200/20 bg-sky-300/12 text-sm font-bold text-sky-100 shadow-[0_10px_24px_rgba(14,165,233,0.12)]">
                        0{index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">{item.label}</p>
                        <p className="mt-1 text-[1.02rem] font-semibold leading-6 text-white">{item.title}</p>
                        <p className="mt-2 max-w-md text-sm leading-6 text-slate-300/82">{item.value}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-[1.45rem] border border-sky-200/16 bg-[linear-gradient(135deg,rgba(125,211,252,0.12),rgba(255,255,255,0.05))] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-100">In plain English</p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-100/92">
                  MigraTeck should feel like one coordinated platform company from the first scroll, not a stack of unrelated pages dressed in the same colors.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

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
