import Link from "next/link";
import { downloadGroups } from "@/content/downloads";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Downloads",
  description:
    "MigraTeck publishes software, tooling, and release assets through verified distribution channels with clear release-state labeling.",
  path: "/downloads",
});

const releaseStatuses: Record<string, { label: string; className: string }> = {
  planned: { label: "Planned", className: "border-white/10 bg-white/5 text-slate-400" },
  preview: { label: "Preview", className: "border-amber-400/20 bg-amber-400/10 text-amber-300" },
  managed: { label: "Managed", className: "border-sky-400/20 bg-sky-400/10 text-sky-300" },
  internal: { label: "Internal", className: "border-purple-400/20 bg-purple-400/10 text-purple-300" },
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
              Verified distribution
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Official software delivery through verified distribution channels.
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              MigraTeck publishes applications, tooling, extensions, and release assets
              through controlled distribution paths with clear release-state labeling.
              Availability is shown as it actually stands.
            </p>
          </div>
        </div>
      </section>

      {/* download groups */}
      {downloadGroups.map((group) => (
          <section key={group.title} className={cn("border-b border-white/10", ui.sectionPySmall)}>
          <div className={ui.maxW}>
            <p className={ui.eyebrowBrand}>{group.title}</p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">{group.description}</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => {
                const fallback = { label: "Planned", className: "border-white/10 bg-white/5 text-slate-400" };
                const status = releaseStatuses[item.releaseState] ?? fallback;
                return (
                  <div key={item.name} className={cn(ui.card, "flex flex-col p-5")}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold text-white">{item.name}</h3>
                      <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", status.className)}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-3 flex-1 text-sm leading-6 text-slate-400">{item.description}</p>
                    <div className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-400">
                      <p><span className="font-medium text-slate-300">Platform:</span> {item.platform}</p>
                      <p className="mt-1"><span className="font-medium text-slate-300">Availability:</span> {item.availability}</p>
                      {item.verifiedSource && (
                        <p className="mt-1 font-medium text-emerald-400">✓ Verified source</p>
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
