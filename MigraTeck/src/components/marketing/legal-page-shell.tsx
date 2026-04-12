import type { ReactNode } from "react";
import Link from "next/link";
import { LEGAL_PAGE_PATHS } from "@/lib/legal";

export function LegalPageShell({
  title,
  lastUpdated,
  summary,
  children,
}: {
  title: string;
  lastUpdated: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto w-full max-w-4xl">
        <div className="overflow-hidden rounded-[2rem] border border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(109,94,252,0.18),transparent_30%),linear-gradient(180deg,#0b1220,#111827)] p-8 text-white shadow-[0_30px_80px_rgba(15,23,42,0.35)]">
          <div className="flex flex-wrap items-center gap-3 text-sm text-white/72">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-semibold uppercase tracking-[0.18em] text-white/62">
              Legal
            </span>
            <Link href={LEGAL_PAGE_PATHS.privacy} className="rounded-full border border-white/10 px-3 py-1 transition hover:border-white/25 hover:text-white">
              Privacy
            </Link>
            <Link href={LEGAL_PAGE_PATHS.terms} className="rounded-full border border-white/10 px-3 py-1 transition hover:border-white/25 hover:text-white">
              Terms
            </Link>
          </div>
          <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/74">{summary}</p>
          <p className="mt-5 text-sm font-medium text-white/56">Last updated: {lastUpdated}</p>
        </div>

        <article className="mt-8 rounded-[2rem] border border-[var(--line)] bg-white p-6 shadow-sm sm:p-8 [&_a]:font-semibold [&_a]:text-[var(--brand-600)] [&_a]:underline-offset-4 hover:[&_a]:text-[var(--brand-700)] [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:font-[var(--font-space-grotesk)] [&_h2]:text-2xl [&_h2]:font-black [&_h2]:tracking-tight [&_h2]:text-[var(--ink)] [&_h2:first-child]:mt-0 [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-[var(--ink)] [&_li]:text-[var(--ink-muted)] [&_p]:mt-3 [&_p]:text-sm [&_p]:leading-7 [&_p]:text-[var(--ink-muted)] [&_strong]:text-[var(--ink)] [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          {children}
        </article>
      </div>
    </section>
  );
}
