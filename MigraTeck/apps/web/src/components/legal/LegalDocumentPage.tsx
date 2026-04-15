import Link from "next/link";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";
import type { LegalDocument } from "@/content/legal";

export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-0 top-0 h-[320px] w-[320px] rounded-full bg-cyan-500/10 blur-[90px]" />
        <div className="pointer-events-none absolute right-0 bottom-0 h-[320px] w-[320px] rounded-full bg-fuchsia-500/10 blur-[90px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-28 sm:pt-40")}>
          <div className="max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              {document.category === "core" ? "Legal policy" : "Product addendum"}
            </p>
            <h1 className="mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl">
              {document.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300/90">
              {document.summary}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <span className={ui.pillDark}>Last updated {document.lastUpdated}</span>
              <span className={ui.pillDark}>{document.version}</span>
              <span className={ui.pillDark}>Entity: MigraTeck</span>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      <section className={ui.sectionPy}>
        <div className={cn(ui.maxW, "grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]")}>
          <article className="space-y-6">
            <div className={cn(ui.card, "p-6 sm:p-8")}>
              <p className={ui.eyebrowBrand}>Overview</p>
              <p className="mt-4 text-base leading-8 text-slate-700">
                {document.description}
              </p>
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
                        <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/10 text-blue-600">
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
                    className="block text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700"
                  >
                    {link.label} →
                  </Link>
                ))}
              </div>
            </div>

            <div className={cn(ui.card, "p-6")}>
              <p className={ui.eyebrowBrand}>Notice</p>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                These policy pages provide the current public legal surface for the MigraTeck
                ecosystem. Product-specific addenda supplement, and do not replace, the shared
                MigraTeck policies.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
