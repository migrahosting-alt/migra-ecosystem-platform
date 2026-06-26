import Link from "next/link";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";
import type { LegalDocument } from "@/content/legal";

export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-[-4rem] top-20 h-72 w-72 rounded-full bg-violet-300/25 blur-[90px]" />
        <div className="pointer-events-none absolute right-[-5rem] bottom-0 h-80 w-80 rounded-full bg-orange-200/35 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="max-w-4xl">
            <p className={ui.eyebrowBrand}>
              {document.category === "core" ? "Legal policy" : "Product addendum"}
            </p>
            <h1 className={cn(ui.h1, "mt-5 max-w-3xl text-4xl sm:text-5xl lg:text-6xl")}>
              {document.title}
            </h1>
            <p className={cn(ui.body, "mt-6 max-w-3xl")}>{document.summary}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <span className={ui.pill}>Last updated {document.lastUpdated}</span>
              <span className={ui.pill}>{document.version}</span>
              <span className={ui.pill}>Entity: MigraTeck</span>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={cn(ui.maxW, "grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]")}>
          <article className="space-y-6">
            <div className={cn(ui.card, "p-6 sm:p-8")}>
              <p className={ui.eyebrowBrand}>Overview</p>
              <p className="mt-4 text-base leading-8 text-slate-700">{document.description}</p>
            </div>

            {document.sections.map((section) => (
              <section key={section.title} className={cn(ui.card, "p-6 sm:p-8")}>
                <h2 className={cn(ui.h3, "text-2xl")}>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="mt-4 text-base leading-8 text-slate-700">
                    {paragraph}
                  </p>
                ))}
                {section.bullets?.length ? (
                  <ul className="mt-5 space-y-3">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-3">
                        <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-fuchsia-600">
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </span>
                        <span className="text-sm leading-7 text-slate-700">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </article>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <div className={cn(ui.card, "p-6")}>
              <p className={ui.eyebrowBrand}>Applies to</p>
              <ul className="mt-4 space-y-3">
                {document.appliesTo.map((item) => (
                  <li key={item} className="text-sm leading-6 text-slate-700">
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className={cn(ui.card, "p-6")}>
              <p className={ui.eyebrowBrand}>Related documents</p>
              <div className="mt-4 space-y-3">
                {document.relatedLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="block text-sm font-semibold text-fuchsia-700 transition-colors hover:text-fuchsia-800"
                  >
                    {link.label} →
                  </Link>
                ))}
              </div>
            </div>

            <div className={cn(ui.card, "p-6")}>
              <p className={ui.eyebrowBrand}>Notice</p>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                These pages present the current public legal surface for MigraTeck and
                MigraHosting. Product-specific addenda supplement the shared policies and do
                not replace them.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
