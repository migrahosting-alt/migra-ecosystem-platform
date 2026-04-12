import Link from "next/link";
import Image from "next/image";
import { products, productsGroupedByCategory } from "@/data/products";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Products",
  description:
    "Browse the complete MigraTeck product registry — 10 official products across 5 categories with shared identity, governance, and distribution.",
  path: "/products",
});

export default function ProductsPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "MigraTeck Official Products",
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.name,
      url: absoluteUrl(`/products/${p.slug}`),
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* hero */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 top-20 h-[500px] w-[400px] rounded-full bg-cyan-400/15 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-32 sm:pb-28 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Product registry
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              {products.length} products,{" "}
              <span className="gradient-text-hero">one ecosystem.</span>
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              Every product shares identity foundations, governance policies,
              and distribution channels within the unified MigraTeck platform.
            </p>
          </div>

          {/* category anchors */}
          <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-2">
            {productsGroupedByCategory.map(({ category }) => (
              <a
                key={category}
                href={`#${category}`}
                className={ui.pillDark}
              >
                {category.replace(/-/g, " ")}
              </a>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* product categories */}
      {productsGroupedByCategory.map(({ category, products: catProducts }) => (
        <section key={category} id={category} className={cn("scroll-mt-20 border-b border-slate-100", ui.sectionPySmall)}>
          <div className={ui.maxW}>
            <p className={ui.eyebrowBrand}>{category.replace(/-/g, " ")}</p>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {catProducts.map((p) => (
                <Link
                  key={p.key}
                  href={`/products/${p.slug}`}
                  className={cn(ui.card, ui.cardHover, "group block p-6")}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(ui.logoBadge, "overflow-hidden")}>
                      <Image src={p.logo} alt={p.name} fill sizes="40px" className="object-contain p-1" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-950">{p.name}</h3>
                      <span className={ui.statusBadge}>official</span>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-600">{p.shortDescription}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {p.capabilities.slice(0, 3).map((c) => (
                      <span key={c} className={ui.pill}>{c}</span>
                    ))}
                  </div>
                  <p className="mt-4 text-sm font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100">
                    View details →
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* CTA */}
      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Ready to explore the platform?</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            See how all {products.length} products connect through shared architecture layers.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/platform" className={ui.btnPrimaryLight}>Platform architecture</Link>
            <Link href="/developers" className={ui.btnSecondaryDark}>Developer docs</Link>
          </div>
        </div>
      </section>
    </>
  );
}
