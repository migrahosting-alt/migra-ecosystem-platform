import Link from "next/link";
import { downloadGroups } from "@/content/downloads";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Downloads",
  description:
    "Official MigraTeck and MigraHosting downloads, release assets, and verified distribution channels.",
  path: "/downloads",
});

const releaseStatuses: Record<string, { label: string; className: string }> = {
  planned: {
    label: "Planned",
    className: "border-stone-200 bg-stone-50 text-stone-600",
  },
  preview: {
    label: "Preview",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  managed: {
    label: "Managed",
    className: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  },
  internal: {
    label: "Internal",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
};

function getReleaseStatus(state: string) {
  return (
    releaseStatuses[state as keyof typeof releaseStatuses] ?? {
      label: "Planned",
      className: "border-stone-200 bg-stone-50 text-stone-600",
    }
  );
}

export default function DownloadsPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Downloads", url: absoluteUrl("/downloads") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-[-4rem] top-24 h-72 w-72 rounded-full bg-violet-300/25 blur-[90px]" />
        <div className="pointer-events-none absolute right-[-5rem] bottom-0 h-80 w-80 rounded-full bg-orange-200/35 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="max-w-3xl">
            <p className={ui.eyebrowBrand}>Downloads</p>
            <h1 className={cn(ui.h1, "mt-5 max-w-2xl")}>
              Official software and release assets from verified sources.
            </h1>
            <p className={cn(ui.body, "mt-6 max-w-2xl")}>
              Use this page to find public downloads, release channels, and availability details.
              Status labels are shown as they actually stand so customers and operators can see
              what is ready, planned, managed, or internal.
            </p>
          </div>
        </div>
      </section>

      {downloadGroups.map((group) => (
        <section key={group.title} className={ui.sectionPySmall}>
          <div className={ui.maxW}>
            <p className={ui.eyebrowBrand}>{group.title}</p>
            <h2 className={cn(ui.h3, "mt-3 text-[1.6rem]")}>{group.description}</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => {
                const status = getReleaseStatus(item.releaseState);

                return (
                  <div key={item.name} className={cn(ui.card, "flex flex-col p-5")}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-semibold text-[var(--brand-ink)]">{item.name}</h3>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]",
                          status.className,
                        )}
                      >
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{item.description}</p>
                    <div className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-slate-500">
                      <p>
                        <span className="font-semibold text-slate-700">Platform:</span> {item.platform}
                      </p>
                      <p className="mt-1">
                        <span className="font-semibold text-slate-700">Availability:</span>{" "}
                        {item.availability}
                      </p>
                      {item.verifiedSource ? (
                        <p className="mt-2 font-semibold text-emerald-700">Verified source</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}

      <section className={cn(ui.sectionPySmall, "pt-4 sm:pt-6")}>
        <div className={ui.maxWNarrow}>
          <div className={cn(ui.card, "p-6 text-center sm:p-8")}>
            <p className={ui.eyebrowBrand}>Need the next step?</p>
            <h2 className={cn(ui.h3, "mt-3")}>Check product details or review the security model.</h2>
            <p className={cn(ui.bodySmall, "mx-auto mt-3 max-w-2xl")}>
              Downloads are only one part of the customer path. Use the product and security
              pages if you need more context before installing or requesting access.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/products" className={ui.btnPrimary}>
                Browse products
              </Link>
              <Link href="/security" className={ui.btnSecondary}>
                View security
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
