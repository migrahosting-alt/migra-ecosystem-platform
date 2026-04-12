import Link from "next/link";
import { downloadGroups } from "@/content/downloads";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Downloads & Distribution",
  description:
    "Access official MigraTeck applications, developer tools, plugins, and software assets through the centralized distribution system.",
  path: "/downloads",
});

const releaseStatuses: Record<string, { label: string; className: string }> = {
  planned: { label: "Planned", className: "border-slate-200 bg-slate-50 text-slate-600" },
  preview: { label: "Preview", className: "border-amber-200 bg-amber-50 text-amber-700" },
  managed: { label: "Managed", className: "border-sky-200 bg-sky-50 text-sky-700" },
  internal: { label: "Internal", className: "border-purple-200 bg-purple-50 text-purple-700" },
};

export default function DownloadsPage() {
  return (
    <>
      {/* hero */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute -left-32 top-40 h-[400px] w-[400px] rounded-full bg-cyan-400/15 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-32 sm:pb-28 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Distribution system
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Official software{" "}
              <span className="gradient-text-hero">delivery.</span>
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              Applications, developer tools, plugins, and scripts — all through
              verified distribution channels with release integrity tracking.
            </p>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* download groups */}
      {downloadGroups.map((group) => (
        <section key={group.title} className={cn("border-b border-slate-100", ui.sectionPySmall)}>
          <div className={ui.maxW}>
            <p className={ui.eyebrowBrand}>{group.title}</p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{group.description}</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => {
                const fallback = { label: "Planned", className: "border-slate-200 bg-slate-50 text-slate-600" };
                const status = releaseStatuses[item.releaseState] ?? fallback;
                return (
                  <div key={item.name} className={cn(ui.card, "flex flex-col p-5")}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold text-slate-950">{item.name}</h3>
                      <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", status.className)}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{item.description}</p>
                    <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <p><span className="font-medium text-slate-700">Platform:</span> {item.platform}</p>
                      <p className="mt-1"><span className="font-medium text-slate-700">Availability:</span> {item.availability}</p>
                      {item.verifiedSource && (
                        <p className="mt-1 font-medium text-emerald-600">✓ Verified source</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}

      {/* integrity note */}
      <section className={ui.sectionPySmall}>
        <div className={ui.maxWNarrow}>
          <div className={cn(ui.card, "p-6 sm:p-8 text-center")}>
            <p className={ui.eyebrowBrand}>Release integrity</p>
            <h2 className={cn(ui.h3, "mt-4")}>Every artifact ships from verified source.</h2>
            <p className={cn(ui.bodySmall, "mx-auto mt-3 max-w-lg")}>
              MigraTeck distribution channels enforce verified-source validation,
              access-aware visibility, and honest release-state communication for every asset.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/products" className={ui.btnPrimary}>Products</Link>
              <Link href="/security" className={ui.btnSecondary}>Security model</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
