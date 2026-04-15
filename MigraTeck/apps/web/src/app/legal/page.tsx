import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";
import { coreLegalDocuments, productLegalDocuments } from "@/content/legal";

export const metadata = buildPageMetadata({
  title: "Legal",
  description:
    "Centralized MigraTeck legal policies and product-specific addenda for the ecosystem.",
  path: "/legal",
});

export default function LegalIndexPage() {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/4 top-10 h-[360px] w-[360px] rounded-full bg-sky-500/10 blur-[100px]" />
        <div className="pointer-events-none absolute right-0 bottom-0 h-[320px] w-[320px] rounded-full bg-fuchsia-500/10 blur-[90px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-28 sm:pt-40")}>
          <div className="max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Legal center
            </p>
            <h1 className="mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              One legal system for the entire MigraTeck ecosystem.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300/90">
              MigraTeck is the legal entity. Products operate under shared platform policies,
              with modular addenda only where service-specific rules are needed.
            </p>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className={cn(ui.card, "p-6 sm:p-8")}>
              <p className={ui.eyebrowBrand}>Shared core</p>
              <h2 className={cn(ui.h2, "mt-3 text-3xl sm:text-4xl")}>Platform policies</h2>
              <p className="mt-4 text-base leading-8 text-slate-600">
                These documents are the source of truth for accounts, privacy, billing,
                acceptable use, and security across every product.
              </p>
              <div className="mt-8 grid gap-4">
                {coreLegalDocuments.map((document) => (
                  <Link
                    key={document.slug}
                    href={`/legal/${document.slug}`}
                    className={cn(ui.card, ui.cardHover, "block p-5")}
                  >
                    <p className={ui.eyebrowBrand}>{document.shortTitle}</p>
                    <h3 className={cn(ui.h3, "mt-2 text-xl")}>{document.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{document.summary}</p>
                  </Link>
                ))}
              </div>
            </div>

            <div className={cn(ui.card, "p-6 sm:p-8")}>
              <p className={ui.eyebrowBrand}>Product extensions</p>
              <h2 className={cn(ui.h2, "mt-3 text-3xl sm:text-4xl")}>Service addenda</h2>
              <p className="mt-4 text-base leading-8 text-slate-600">
                Addenda cover product-specific billing, compliance, content, and operational
                obligations without duplicating the full legal stack per product.
              </p>
              <div className="mt-8 grid gap-4">
                {productLegalDocuments.map((document) => (
                  <Link
                    key={document.slug}
                    href={`/legal/${document.slug}`}
                    className={cn(ui.card, ui.cardHover, "block p-5")}
                  >
                    <p className={ui.eyebrowBrand}>{document.shortTitle}</p>
                    <h3 className={cn(ui.h3, "mt-2 text-xl")}>{document.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{document.summary}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
