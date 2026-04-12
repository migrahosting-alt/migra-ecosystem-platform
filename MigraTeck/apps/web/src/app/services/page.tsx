import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Services",
  description:
    "Platform enablement, migration planning, operational automation design, and distribution readiness — structured execution layers connected to the broader ecosystem.",
  path: "/services",
});

const services = [
  {
    title: "Platform enablement",
    desc: "Implementation support for organizations adopting unified identity, governance, and operational access across products.",
    audience: "Teams consolidating fragmented product entry points into one platform model.",
    outcome: "A clearer operating surface for access, product administration, and ecosystem alignment.",
  },
  {
    title: "Migration and rollout",
    desc: "Structured migration planning for infrastructure, communications, storage, and workflow systems entering the MigraTeck ecosystem.",
    audience: "Organizations moving legacy systems or disconnected tools into a coordinated platform posture.",
    outcome: "A managed rollout path with fewer broken handoffs between services, products, and distribution.",
  },
  {
    title: "Operational automation",
    desc: "Workflow design, execution routing, and automation planning aligned to MigraPilot, MigraPanel, and future control-plane tooling.",
    audience: "Operational teams that need repeatable workflows, controlled execution, and better systems handoff.",
    outcome: "More deterministic orchestration across task execution, platform actions, and product-connected operations.",
  },
  {
    title: "Distribution readiness",
    desc: "Release planning and artifact delivery preparation for teams needing secure, verified software distribution.",
    audience: "Product and engineering teams preparing software, tooling, or release assets for trusted delivery.",
    outcome: "A distribution posture aligned with verified source, access controls, and honest release-state communication.",
  },
] as const;

export default function ServicesPage() {
  return (
    <>
      {/* hero */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 bottom-0 h-[400px] w-[400px] rounded-full bg-pink-500/10 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Services
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Execution layers{" "}
              <span className="gradient-text-hero">for the platform.</span>
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              Rollout, migration, automation, and delivery — framed as structured
              execution layers connected to the broader ecosystem.
            </p>
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-4">
              <Link href="/platform" className={ui.btnPrimaryLight}>Platform overview</Link>
              <Link href="/products" className={ui.btnSecondaryDark}>View products</Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* service cards */}
      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-6 sm:grid-cols-2">
            {services.map((s) => (
              <div key={s.title} className={cn(ui.card, "flex flex-col p-6 sm:p-8")}>
                <p className={ui.eyebrowBrand}>Service track</p>
                <h3 className={cn(ui.h3, "mt-3")}>{s.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{s.desc}</p>
                <div className="mt-auto pt-6 space-y-4 border-t border-slate-100">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Who it is for</p>
                    <p className="mt-1 text-sm text-slate-600">{s.audience}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Intended outcome</p>
                    <p className="mt-1 text-sm text-slate-600">{s.outcome}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Services support the platform.</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            This route exists to show where MigraTeck helps organizations adopt,
            migrate, automate, and distribute inside the ecosystem.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/platform" className={ui.btnPrimaryLight}>Review architecture</Link>
            <Link href="/products" className={ui.btnSecondaryDark}>View products</Link>
          </div>
        </div>
      </section>
    </>
  );
}
