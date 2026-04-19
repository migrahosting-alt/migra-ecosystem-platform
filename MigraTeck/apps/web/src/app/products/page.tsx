import Link from "next/link";
import Image from "next/image";
import { products, officialProductUrls } from "@/data/products";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Products",
  description:
    "Explore the MigraTeck product ecosystem across platform core, infrastructure, communications, workflow, billing, and growth.",
  path: "/products",
});

const howItWorksItems = [
  {
    title: "Shared identity",
    description: "One login, one access layer, one permission model across every product you use.",
  },
  {
    title: "Shared infrastructure",
    description: "Hosting, delivery, and distribution run on the same underlying system — no silos.",
  },
  {
    title: "Shared workflows",
    description: "Intake, billing, messaging, and operations connect instead of running in separate tools.",
  },
  {
    title: "Shared platform",
    description: "Every product is part of MigraTeck — one company, one ecosystem, one place to manage it all.",
  },
] as const;

const useCases = [
  {
    label: "SaaS platforms",
    description: "Host, manage access, bill subscribers, and run support — all inside one ecosystem.",
  },
  {
    label: "Service businesses",
    description: "Capture clients, onboard them, communicate, invoice, and deliver through connected tools.",
  },
  {
    label: "Digital product companies",
    description: "Distribute software, manage downloads, handle licensing, and coordinate communication.",
  },
  {
    label: "Communication-heavy operations",
    description: "Run voice, email, messaging, and intake in coordination with your infrastructure.",
  },
] as const;

// Products to feature prominently at the top (exclude the platform "migrateck" entry itself)
const ecosystemProducts = products.filter((p) => p.key !== "migrateck");
const featuredProducts = ecosystemProducts.filter((p) => p.featured);
const remainingProducts = ecosystemProducts.filter((p) => !p.featured);

export default function ProductsPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "MigraTeck Products",
    numberOfItems: ecosystemProducts.length,
    itemListElement: ecosystemProducts.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.name,
      url: absoluteUrl(`/products/${p.slug}`),
    })),
  };

  return (
    <main className="relative overflow-hidden bg-[#071121] text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.22),transparent_30%),radial-gradient(circle_at_84%_18%,rgba(99,102,241,0.14),transparent_26%),linear-gradient(180deg,rgba(16,45,120,0.28),rgba(7,17,33,1)_22%,rgba(5,10,20,1)_100%)]" />
      <div className="absolute left-[-8rem] top-28 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="absolute right-[-6rem] top-[20rem] h-[26rem] w-[26rem] rounded-full bg-violet-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1280px] px-6 pb-24 pt-24 md:px-8 lg:px-10">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="pb-20 pt-8">
          <div className="inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/90">
            Products
          </div>

          <h1 className="mt-6 max-w-[820px] text-5xl font-semibold leading-[0.98] tracking-[-0.05em] text-white md:text-6xl lg:text-7xl">
            Products built to work together — and stand on their own.
          </h1>

          <p className="mt-6 max-w-[620px] text-base leading-8 text-white/68 md:text-lg">
            Each MigraTeck product is a complete solution. Together, they form one coordinated platform for businesses that need hosting, communication, billing, automation, and operations to move as one.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/portfolio"
              className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400"
            >
              Explore ecosystem
            </Link>
            <Link
              href="/platform"
              className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/82 transition hover:bg-white/8"
            >
              View platform
            </Link>
          </div>
        </section>

        {/* ── Featured products ────────────────────────────────── */}
        {featuredProducts.length > 0 && (
          <section className="border-t border-white/8 py-16">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/85">Featured</p>
            <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {featuredProducts.map((product) => (
                <Link
                  key={product.key}
                  href={`/products/${product.slug}`}
                  className="group relative flex flex-col overflow-hidden rounded-[28px] border border-white/12 bg-white/[0.05] p-7 no-underline backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-white/22 hover:bg-white/[0.08]"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-70" />
                  <div className="flex items-start justify-between gap-4">
                    <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-white/12 bg-white/8 p-2.5">
                      <Image src={product.logo} alt={product.name} fill sizes="56px" className="object-contain p-0.5" />
                    </div>
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-200/80">
                      Featured
                    </span>
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-white">{product.name}</h3>
                  <p className="mt-3 flex-1 text-sm leading-7 text-white/65">{product.shortDescription}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {product.capabilities.slice(0, 2).map((cap) => (
                      <span key={cap} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-white/55">
                        {cap}
                      </span>
                    ))}
                  </div>
                  <p className="mt-5 text-sm font-medium text-blue-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    View product →
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── All products grid ────────────────────────────────── */}
        <section id="all-products" className="border-t border-white/8 py-16">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/85">All products</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
                The full MigraTeck ecosystem
              </h2>
            </div>
            <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/50">
              {ecosystemProducts.length} products
            </span>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ecosystemProducts.map((product) => (
              <Link
                key={product.key}
                href={`/products/${product.slug}`}
                className="group relative flex flex-col overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.04] p-5 no-underline backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.07]"
              >
                <div className="flex items-center gap-3.5">
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/12 bg-white/8 p-1.5">
                    <Image src={product.logo} alt={product.name} fill sizes="40px" className="object-contain p-0.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight text-white">{product.name}</p>
                  </div>
                </div>
                <p className="mt-3.5 flex-1 text-sm leading-6 text-white/58">{product.shortDescription}</p>
                <p className="mt-4 text-sm font-medium text-blue-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  View product →
                </p>
              </Link>
            ))}
          </div>
        </section>

        {/* ── How products connect ─────────────────────────────── */}
        <section className="border-t border-white/8 py-16">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/85">How it works</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
                Designed to work together
              </h2>
              <p className="mt-5 text-base leading-8 text-white/65">
                Identity, hosting, communication, and workflows stay connected across every product, so your business operates as one system instead of disconnected tools.
              </p>
              <Link
                href="/platform"
                className="mt-8 inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/80 transition hover:bg-white/8"
              >
                See how the platform works →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {howItWorksItems.map((item) => (
                <div key={item.title} className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-400/20 bg-blue-400/10">
                    <svg className="h-4 w-4 text-blue-300/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/58">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Use cases ────────────────────────────────────────── */}
        <section className="border-t border-white/8 py-16">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/85">Use cases</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
            What you can build with MigraTeck
          </h2>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {useCases.map((item) => (
              <div key={item.label} className="rounded-[22px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
                <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{item.label}</h3>
                <p className="mt-3 text-sm leading-7 text-white/62">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="border-t border-white/8 pt-16">
          <div className="rounded-[36px] border border-white/10 bg-white/[0.05] px-6 py-12 text-center backdrop-blur-2xl md:px-10 md:py-16">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/85">Get started</p>
            <h2 className="mx-auto mt-4 max-w-[720px] text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
              Start building with MigraTeck.
            </h2>
            <p className="mx-auto mt-5 max-w-[600px] text-base leading-8 text-white/65">
              Pick the products you need. Use them independently or together. Everything runs on the same platform.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400"
              >
                Create account
              </Link>
              <Link
                href="/platform"
                className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/82 transition hover:bg-white/8"
              >
                Explore platform
              </Link>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
