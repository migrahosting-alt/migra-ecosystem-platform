import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";
import { coreLegalDocuments, productLegalDocuments } from "@/content/legal";

export const metadata = buildPageMetadata({
  title: "Legal",
  description:
    "Read MigraTeck and MigraHosting legal policies covering privacy, billing, acceptable use, security, and product-specific service terms.",
  path: "/legal",
});

export default function LegalIndexPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Legal", url: absoluteUrl("/legal") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-[-4rem] top-20 h-72 w-72 rounded-full bg-violet-300/25 blur-[90px]" />
        <div className="pointer-events-none absolute right-[-5rem] bottom-0 h-80 w-80 rounded-full bg-orange-200/35 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="max-w-4xl">
            <p className={ui.eyebrowBrand}>Legal</p>
            <h1 className={cn(ui.h1, "mt-5 max-w-3xl")}>
              Policies, service terms, and legal notices for MigraTeck and MigraHosting.
            </h1>
            <p className={cn(ui.body, "mt-6 max-w-3xl")}>
              These documents cover the shared legal foundation for accounts, privacy, billing,
              acceptable use, security, and service-specific obligations where they are needed.
            </p>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className={cn(ui.card, "p-6 sm:p-8")}>
              <p className={ui.eyebrowBrand}>Shared policies</p>
              <h2 className={cn(ui.h2, "mt-3 text-3xl sm:text-4xl")}>Core legal documents</h2>
              <p className="mt-4 text-base leading-8 text-slate-600">
                Start here for the policies that apply across customer accounts, privacy,
                billing, acceptable use, and security.
              </p>
              <div className="mt-8 grid gap-4">
                {coreLegalDocuments.map((document) => (
                  <Link
                    key={document.slug}
                    href={`/legal/${document.slug}`}
                    className={cn(ui.cardMuted, ui.cardHover, "block p-5")}
                  >
                    <p className={ui.eyebrowBrand}>{document.shortTitle}</p>
                    <h3 className={cn(ui.h3, "mt-2 text-xl")}>{document.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{document.summary}</p>
                  </Link>
                ))}
              </div>
            </div>

            <div className={cn(ui.card, "p-6 sm:p-8")}>
              <p className={ui.eyebrowBrand}>Service-specific terms</p>
              <h2 className={cn(ui.h2, "mt-3 text-3xl sm:text-4xl")}>Product addenda</h2>
              <p className="mt-4 text-base leading-8 text-slate-600">
                Use these addenda when a specific service, delivery path, or communications
                program has obligations beyond the shared policies above.
              </p>
              <div className="mt-8 grid gap-4">
                {productLegalDocuments.map((document) => (
                  <Link
                    key={document.slug}
                    href={`/legal/${document.slug}`}
                    className={cn(ui.cardMuted, ui.cardHover, "block p-5")}
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
