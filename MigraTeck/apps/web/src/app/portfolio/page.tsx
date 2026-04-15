import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

const portfolioDeckPath = "/portfolio/migrahosting-corporate-portfolio/index.html";
const portfolioPdfPath = "/portfolio/migrahosting-corporate-portfolio/MigraHosting-Corporate-Portfolio.pdf";

export const metadata = buildPageMetadata({
  title: "Portfolio",
  description:
    "A portfolio view of MigraTeck's public platform posture, flagship products, and commercial launch direction.",
  path: "/portfolio",
});

const highlights = [
  { title: "Integrated product ecosystem", description: "Multiple products presented under one access, governance, and launch narrative instead of disconnected microsites." },
  { title: "Commercial launch readiness", description: "Public pricing and services now support actual buyer paths, not just broad platform claims." },
  { title: "Developer and distribution clarity", description: "Documentation, downloads, and trust posture are now easier to find from the primary public site." },
] as const;

const showcase = [
  { label: "Product count", value: "10" },
  { label: "Public routes refreshed", value: "8+" },
  { label: "Commercial offers surfaced", value: "2" },
] as const;

const stableUrls = [
  { label: "Landing page", href: "/portfolio" },
  { label: "Web deck", href: portfolioDeckPath },
  { label: "PDF artifact", href: portfolioPdfPath },
] as const;

export default function PortfolioPage() {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 top-20 h-[500px] w-[400px] rounded-full bg-cyan-400/15 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="grid gap-8 lg:grid-cols-[1fr_0.92fr] lg:items-center">
            <div>
              <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
                Portfolio
              </p>
              <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
                A public portfolio for the MigraTeck platform story.
              </h1>
              <p className="animate-fade-up-d2 mt-6 max-w-2xl text-lg leading-8 text-slate-300/90">
                This route summarizes what the redesigned public site is meant to communicate: a real platform business with products, services, pricing, distribution, and developer posture aligned.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link href={portfolioDeckPath} className={ui.btnPrimaryLight}>Open web deck</Link>
                <Link href={portfolioPdfPath} className={ui.btnSecondaryDark}>Download PDF</Link>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-white/8 p-6 backdrop-blur">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Snapshot</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                {showcase.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-[var(--font-display)] text-3xl font-bold text-white">{item.value}</p>
                    <p className="mt-1 text-sm text-slate-400">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-6 md:grid-cols-3">
            {highlights.map((item, index) => (
              <div key={item.title} className={cn(ui.card, ui.cardHover, "p-6")}>
                <div className={ui.depthNum}>{index + 1}</div>
                <h2 className={cn(ui.h3, "mt-4")}>{item.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className={cn(ui.card, "p-8")}>
              <p className={ui.eyebrowBrand}>What changed</p>
              <h2 className={cn(ui.h2, "mt-4")}>The public app now matches the work that actually ships.</h2>
              <p className={cn(ui.body, "mt-4")}>
                The redesign was ported into the real public-site workspace so navigation, marketing pages, pricing, launch services, and the portfolio bundle now live in the same Next.js app that gets deployed.
              </p>
            </div>
            <div className={cn(ui.card, "p-8")}>
              <p className={ui.eyebrowBrand}>Stable public URLs</p>
              <div className="mt-5 space-y-4">
                {stableUrls.map((item) => (
                  <div key={item.href} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                    <Link href={item.href} className="mt-2 block text-sm font-semibold text-slate-950 hover:text-blue-600">
                      {item.href}
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Explore the refreshed surface.</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            Start with the platform overview, review pricing, or move directly into the product registry and service offers.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/platform" className={ui.btnPrimaryLight}>Platform overview</Link>
            <Link href="/pricing" className={ui.btnSecondaryDark}>View pricing</Link>
          </div>
        </div>
      </section>
    </>
  );
}