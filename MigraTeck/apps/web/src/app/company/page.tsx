import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Company",
  description:
    "MigraTeck builds integrated platform products with centralized identity, access governance, commercial control, and operational scale.",
  path: "/company",
});

const companySections = [
  { title: "Platform-first posture", desc: "MigraTeck is presented as an operating system for products, access, pricing, and execution instead of a loose collection of web properties." },
  { title: "Disciplined system design", desc: "Identity, permissions, billing, and orchestration are treated as shared primitives so product surfaces can scale without drifting apart." },
  { title: "Commercial clarity", desc: "The public site now aligns products, pricing, and services under one narrative structure that is easier for buyers and operators to understand." },
] as const;

const operatingPrinciples = [
  { title: "Products ship together", desc: "Products connect to a shared backbone of identity, governance, and commercial controls instead of being marketed in isolation." },
  { title: "Honesty over polish", desc: "Feature state, readiness, and product posture are described accurately rather than hidden behind generic marketing language." },
  { title: "Composition over sprawl", desc: "The platform grows by connecting well-scoped systems instead of expanding one oversized surface until it loses discipline." },
  { title: "Ops-first standards", desc: "If a product cannot be deployed, monitored, and recovered predictably, it is not ready to represent the business." },
] as const;

export default function CompanyPage() {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-1/4 bottom-0 h-[380px] w-[380px] rounded-full bg-cyan-500/10 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Company
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              A cleaner company story for a serious platform business.
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              MigraTeck builds integrated platform products with centralized identity,
              access governance, commercial control, and operational scale. The public
              site should reflect that with tighter narrative discipline.
            </p>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-6 md:grid-cols-3">
            {companySections.map((section, index) => (
              <div key={section.title} className={cn(ui.card, ui.cardHover, "p-6")}>
                <p className={ui.eyebrowBrand}>Company view 0{index + 1}</p>
                <h2 className={cn(ui.h3, "mt-3")}>{section.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{section.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 left-0 h-[300px] w-[300px] rounded-full bg-blue-500/10 blur-[80px]" />
        <div className={cn(ui.maxWNarrow, "relative py-20 sm:py-24")}>
          <p className={ui.eyebrowDark}>Origin</p>
          <h2 className={cn(ui.h2Dark, "mt-3")}>Started with hosting, grew into a platform.</h2>
          <div className="mt-10 space-y-6">
            <p className="text-base leading-8 text-slate-300">
              MigraTeck began with managed infrastructure delivery under MigraHosting.
              As the ecosystem expanded into communications, operations, automation,
              storage, and control-plane tooling, the business needed one coherent
              public posture instead of several disconnected stories.
            </p>
            <p className="text-base leading-8 text-slate-300">
              The public site is now being aligned around that reality: platform-first,
              operationally credible, and commercially easier to scan.
            </p>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "bg-slate-50/50")}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>How we operate</p>
          <h2 className={cn(ui.h2, "mt-3")}>Operating principles</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {operatingPrinciples.map((p, i) => (
              <div key={p.title} className={cn(ui.card, "p-6")}>
                <span className={ui.depthNum}>0{i + 1}</span>
                <h3 className={cn(ui.h3, "mt-3")}>{p.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-6 sm:grid-cols-3 text-center">
            {([
              ["10", "Products"],
              ["5", "Infrastructure layers"],
              ["1", "Unified identity backbone"],
            ] as const).map(([num, label]) => (
              <div key={label}>
                <p className="font-[var(--font-display)] text-5xl font-bold text-blue-600">{num}</p>
                <p className="mt-2 text-sm text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Explore the ecosystem.</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            See how identity, operations, and distribution connect across every product.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/platform" className={ui.btnPrimaryLight}>Platform architecture</Link>
            <Link href="/products" className={ui.btnSecondaryDark}>All products</Link>
          </div>
        </div>
      </section>
    </>
  );
}
