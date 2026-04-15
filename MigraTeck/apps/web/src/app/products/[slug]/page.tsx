import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { cn } from "@/lib/cn";
import { getProductLegalHref } from "@/content/legal";
import ui from "@/lib/ui";
import { products, productCategories } from "@/data/products";

export const dynamic = "force-dynamic";

/* ---------- metadata ---------- */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = products.find((p) => p.slug === slug);
  if (!product) return {};
  return {
    title: `${product.name} — MigraTeck`,
    description: product.shortDescription,
  };
}

/* ---------- page ---------- */
export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const product = products.find((p) => p.slug === slug);
  if (!product) notFound();

  const cat = productCategories[product.category];
  const related = products.filter(
    (p) => p.category === product.category && p.slug !== product.slug,
  );
  const productLegalHref = getProductLegalHref(product.slug);

  return (
    <>
      {/* hero */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 bottom-0 h-[350px] w-[350px] rounded-full bg-pink-500/10 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="flex items-start gap-6">
            <Image
              src={product.logo}
              alt={product.name}
              width={64}
              height={64}
              className="animate-fade-up h-16 w-16 rounded-xl bg-white/10 p-2 backdrop-blur-sm"
            />
            <div className="min-w-0">
              <div className="animate-fade-up flex flex-wrap items-center gap-3">
                <span className={ui.pillDark}>{cat.title}</span>
                <span className={ui.statusBadge}>{product.status}</span>
              </div>
              <h1 className="animate-fade-up-d1 mt-4 font-[var(--font-display)] text-4xl font-bold tracking-[-0.03em] text-white sm:text-5xl lg:text-6xl">
                {product.name}
              </h1>
              <p className="animate-fade-up-d2 mt-4 max-w-xl text-lg leading-8 text-slate-300/90">
                {product.shortDescription}
              </p>
              {product.links.officialWebsite && (
                <div className="animate-fade-up-d3 mt-8 flex flex-wrap gap-4">
                  <a
                    href={product.links.officialWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ui.btnPrimaryLight}
                  >
                    Visit {product.name} →
                  </a>
                  <Link href="/products" className={ui.btnSecondaryDark}>All products</Link>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {productLegalHref ? (
        <section className="relative -mt-4 pb-8 pt-4">
          <div className={ui.maxW}>
            <div className={cn(ui.card, "p-5 sm:p-6")}>
              <p className={ui.eyebrowBrand}>Legal notice</p>
              <p className="mt-3 text-sm leading-7 text-slate-700">
                This service is subject to the{" "}
                <Link href="/legal/terms" className="font-semibold text-blue-600">
                  MigraTeck Terms of Service
                </Link>
                ,{" "}
                <Link href="/legal/payment" className="font-semibold text-blue-600">
                  Payment Policy
                </Link>
                ,{" "}
                <Link href="/legal/privacy" className="font-semibold text-blue-600">
                  Privacy Policy
                </Link>
                , and the{" "}
                <Link href={productLegalHref} className="font-semibold text-blue-600">
                  {product.name} service terms
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* about */}
      <section className={ui.sectionPy}>
        <div className={ui.maxWNarrow}>
          <p className={ui.eyebrowBrand}>About</p>
          <h2 className={cn(ui.h2, "mt-3")}>What {product.name} does</h2>
          <p className={cn(ui.body, "mt-4")}>{product.longDescription}</p>
        </div>
      </section>

      {/* capabilities */}
      <section className={cn(ui.sectionPy, "bg-slate-50/50")}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Capabilities</p>
          <h2 className={cn(ui.h2, "mt-3")}>Core surface</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {product.capabilities.map((c) => (
              <div key={c} className={cn(ui.card, "flex items-start gap-3 p-4")}>
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/10 text-blue-600">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <p className="text-sm leading-6 text-slate-700">{c}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* platform linkage – dark */}
      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 left-0 h-[300px] w-[300px] rounded-full bg-blue-500/10 blur-[80px]" />
        <div className={cn(ui.maxW, "relative py-20 sm:py-24")}>
          <p className={ui.eyebrowDark}>Platform linkage</p>
          <h2 className={cn(ui.h2Dark, "mt-3")}>{product.name} in the ecosystem</h2>
          <p className={cn(ui.bodyDark, "mt-4 max-w-xl")}>
            {product.name} lives inside the {cat.title.toLowerCase()} layer — {cat.description.toLowerCase()}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(product.links).map(([key, url]) => {
              if (!url) return null;
              const labels: Record<string, string> = {
                officialWebsite: "Website",
                docsUrl: "Docs",
                apiUrl: "API",
                downloadsUrl: "Downloads",
              };
              const isExternal = url.startsWith("http");
              const Tag = isExternal ? "a" : Link;
              const extra = isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {};
              return (
                <Tag
                  key={key}
                  href={url}
                  {...extra}
                  className={cn(ui.cardDark, "block p-4 text-center transition-colors hover:border-sky-500/40")}
                >
                  <p className="text-sm font-medium text-white">{labels[key] ?? key}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{url}</p>
                </Tag>
              );
            })}
          </div>
        </div>
      </section>

      {/* related */}
      {related.length > 0 && (
        <section className={ui.sectionPy}>
          <div className={ui.maxW}>
            <p className={ui.eyebrowBrand}>Same category</p>
            <h2 className={cn(ui.h2, "mt-3")}>Related products</h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/products/${r.slug}`}
                  className={cn(ui.cardHover, "flex items-start gap-4 p-5")}
                >
                  <Image
                    src={r.logo}
                    alt={r.name}
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-lg"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{r.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{r.shortDescription}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>See the full platform.</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            {product.name} is one of ten products on the MigraTeck ecosystem.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/platform" className={ui.btnPrimaryLight}>Platform architecture</Link>
            <Link href="/products" className={ui.btnSecondaryDark}>All products</Link>
          </div>
        </div>
      </section>
    </>
  );
}
