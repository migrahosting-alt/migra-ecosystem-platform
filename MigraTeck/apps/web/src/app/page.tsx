import Link from "next/link";
import Image from "next/image";
import { products, featuredProducts, productsGroupedByCategory } from "@/data/products";
import { getAccountLinks } from "@/lib/account-links";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

const stats = [
  { value: "10", label: "Official products" },
  { value: "5", label: "Architecture layers" },
  { value: "1", label: "Unified platform" },
] as const;

const pillars = [
  { title: "Identity & Access", desc: "One authentication surface, organization context, and role-aware access across every product." },
  { title: "Governance & Policy", desc: "Operational boundaries, entitlements, and compliance rules applied consistently at the platform layer." },
  { title: "Execution & Runtime", desc: "Provisioning, orchestration, and workflow execution through deterministic platform-managed actions." },
  { title: "Distribution & Delivery", desc: "Verified downloads, release channels, and developer tooling from a single trusted source." },
] as const;

export default function HomePage() {
  const accountLinks = getAccountLinks();

  return (
    <>
      {/* ═══════════ HERO ═══════════ */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        {/* floating orbs */}
        <div className="pointer-events-none absolute -left-40 top-20 h-[600px] w-[600px] rounded-full bg-blue-500/20 blur-[120px] animate-glow-pulse" />
        <div className="pointer-events-none absolute -right-32 top-40 h-[500px] w-[500px] rounded-full bg-cyan-400/15 blur-[100px] animate-glow-pulse" style={{ animationDelay: "2s" }} />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-[300px] w-[400px] rounded-full bg-pink-500/10 blur-[80px]" />

        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40 lg:pb-40 lg:pt-48")}>
          <div className="mx-auto max-w-4xl text-center">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Enterprise platform
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Infrastructure to power{" "}
              <span className="gradient-text-hero">your entire ecosystem.</span>
            </h1>
            <p className="animate-fade-up-d2 mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300/90">
              MigraTeck connects identity, governance, product access, and software
              distribution into one coordinated platform — from your first product
              to your tenth, with one shared account surface across the entire stack.
            </p>
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link href={accountLinks.signup} className={ui.btnPrimaryLight}>
                Create account
                <span aria-hidden="true">→</span>
              </Link>
              <Link href={accountLinks.login} className={ui.btnSecondaryDark}>
                Log in
              </Link>
            </div>
          </div>

          {/* stats strip */}
          <div className="animate-fade-up-d4 mx-auto mt-20 flex max-w-xl justify-center divide-x divide-white/10">
            {stats.map((s) => (
              <div key={s.label} className="flex-1 text-center">
                <p className="font-[var(--font-display)] text-3xl font-bold text-white sm:text-4xl">
                  {s.value}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* gradient fade to white */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* ═══════════ PRODUCT LOGOS STRIP ═══════════ */}
      <section className="relative -mt-4 pb-20 pt-4">
        <div className={ui.maxW}>
          <p className="text-center text-sm font-medium text-slate-500">
            {products.length} products spanning the entire platform
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {products.map((p) => (
              <Link
                key={p.key}
                href={`/products/${p.slug}`}
                className={cn(
                  ui.card,
                  "flex items-center gap-3 px-4 py-3 transition-all duration-200 hover:shadow-md hover:border-slate-300",
                )}
              >
                <div className="relative h-8 w-8">
                  <Image src={p.logo} alt={p.name} fill sizes="32px" className="object-contain" />
                </div>
                <span className="text-sm font-medium text-slate-700">{p.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ PLATFORM PILLARS ═══════════ */}
      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-2xl text-center">
            <p className={ui.eyebrowBrand}>Platform architecture</p>
            <h2 className={cn(ui.h2, "mt-4")}>
              Four layers, one operating surface.
            </h2>
            <p className={cn(ui.body, "mt-4")}>
              Every product connects through shared infrastructure instead of isolated implementations.
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {pillars.map((p, i) => (
              <div key={p.title} className={cn(ui.card, ui.cardHover, "p-6")}>
                <div className={ui.depthNum}>{i + 1}</div>
                <h3 className="mt-4 font-[var(--font-display)] text-lg font-semibold tracking-tight text-slate-950">
                  {p.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{p.desc}</p>
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

      {/* ═══════════ FEATURED PRODUCTS (dark) ═══════════ */}
      <section className="section-dark relative overflow-hidden">
        {/* mesh */}
        <div className="pointer-events-none absolute right-0 top-0 h-[500px] w-[400px] rounded-full bg-blue-600/15 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[300px] rounded-full bg-cyan-500/10 blur-[80px]" />

        <div className={cn(ui.maxW, "relative py-24 sm:py-32")}>
          <div className="flex items-end justify-between gap-6">
            <div>
              <p className={ui.eyebrowDark}>Ecosystem</p>
              <h2 className={cn(ui.h2Dark, "mt-4")}>
                The flagship products.
              </h2>
              <p className={cn(ui.bodyDark, "mt-4 max-w-xl")}>
                Core products carry the same identity, shared governance, and consistent access patterns.
              </p>
            </div>
            <Link href="/products" className={cn(ui.btnSecondaryDark, "hidden sm:inline-flex")}>
              View all products
            </Link>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featuredProducts.map((p) => (
              <Link
                key={p.key}
                href={`/products/${p.slug}`}
                className={cn(ui.cardDark, ui.cardDarkHover, "group block p-6")}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(ui.logoBadgeDark, "overflow-hidden")}>
                    <Image src={p.logo} alt={p.name} fill sizes="40px" className="object-contain p-1" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{p.name}</h3>
                    <p className="text-xs text-slate-500">{p.category.replace(/-/g, " ")}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  {p.shortDescription}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {p.capabilities.slice(0, 3).map((c) => (
                    <span key={c} className={ui.pillDark}>{c}</span>
                  ))}
                </div>
                <p className="mt-4 text-sm font-medium text-sky-400 opacity-0 transition-opacity group-hover:opacity-100">
                  View product →
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ DEVELOPER SECTION ═══════════ */}
      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className={ui.eyebrowBrand}>Developers</p>
              <h2 className={cn(ui.h2, "mt-4")}>
                Build on one platform, not twelve integrations.
              </h2>
              <p className={cn(ui.body, "mt-4")}>
                Consistent APIs, shared authentication, typed contracts, and
                documented entry points across every product in the ecosystem.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/developers" className={ui.btnPrimary}>
                  Read the docs
                  <span aria-hidden="true">→</span>
                </Link>
                <Link href="/security" className={ui.btnSecondary}>Security model</Link>
              </div>
            </div>

            {/* code preview block */}
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0c1222] shadow-2xl">
              <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
                <div className="h-3 w-3 rounded-full bg-slate-700" />
                <div className="h-3 w-3 rounded-full bg-slate-700" />
                <div className="h-3 w-3 rounded-full bg-slate-700" />
                <span className="ml-3 text-xs text-slate-500">api-request.sh</span>
              </div>
              <pre className="overflow-x-auto p-5 text-sm leading-7">
                <code>
                  <span className="text-slate-500">{"# Access any product through the unified API"}</span>{"\n"}
                  <span className="text-sky-400">curl</span>{" "}<span className="text-emerald-400">https://api.migrateck.com/v1/products</span>{" "}<span className="text-slate-500">\</span>{"\n"}
                  {"  "}<span className="text-yellow-300">-H</span>{" "}<span className="text-amber-200">{'"Authorization: Bearer mt_live_..."'}</span>{" "}<span className="text-slate-500">\</span>{"\n"}
                  {"  "}<span className="text-yellow-300">-H</span>{" "}<span className="text-amber-200">{'"Content-Type: application/json"'}</span>
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ CATEGORIES GRID ═══════════ */}
      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Registry</p>
          <h2 className={cn(ui.h2, "mt-4")}>
            Five product categories, one distribution surface.
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {productsGroupedByCategory.map(({ category, products: catProducts }) => (
              <div key={category} className={cn(ui.card, "p-6")}>
                <p className={ui.eyebrow}>{category.replace(/-/g, " ")}</p>
                <div className="mt-5 space-y-3">
                  {catProducts.map((p) => (
                    <Link
                      key={p.key}
                      href={`/products/${p.slug}`}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-slate-50"
                    >
                      <div className="relative h-7 w-7 shrink-0">
                        <Image src={p.logo} alt={p.name} fill sizes="28px" className="object-contain" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500 line-clamp-1">{p.shortDescription}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="section-dark-blue relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-0 h-48 w-[600px] -translate-x-1/2 rounded-full bg-blue-500/15 blur-[80px]" />
        <div className={cn(ui.maxW, "relative py-24 text-center sm:py-32")}>
          <h2 className={ui.h2Dark}>Ready to get started?</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            Start with a MigraTeck Account, then move into product access,
            organization-aware onboarding, and shared session controls.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href={accountLinks.signup} className={ui.btnPrimaryLight}>
              Create account
              <span aria-hidden="true">→</span>
            </Link>
            <Link href={accountLinks.login} className={ui.btnSecondaryDark}>
              Log in
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
