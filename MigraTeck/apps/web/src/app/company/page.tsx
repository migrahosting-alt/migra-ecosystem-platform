import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Company",
  description:
    "MigraTeck builds the operating platform for digital services — identity, governance, execution, and distribution in one coordinated system.",
  path: "/company",
});

const principles = [
  { title: "Products ship together", desc: "Every product connects to a shared backbone of identity, billing, and governance. Nothing releases in isolation." },
  { title: "Honesty over polish", desc: "Feature states are published accurately. Incomplete work is labelled incomplete, not hidden." },
  { title: "Composition over size", desc: "The platform grows by connecting well-scoped products, not by expanding monoliths." },
  { title: "Ops-first mindset", desc: "If a product cannot be deployed, monitored, and recovered predictably, it is not ready to ship." },
] as const;

const milestones = [
  { year: "2024", label: "MigraTeck founded. Infrastructure hosting launched under MigraHosting." },
  { year: "2025", label: "MigraPanel, MigraPilot, MigraVoice, MigraDrive, and MigraMail reach early access." },
  { year: "2026", label: "Unified platform identity. Ten products on one ecosystem backbone." },
] as const;

export default function CompanyPage() {
  return (
    <>
      {/* hero */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-1/4 bottom-0 h-[380px] w-[380px] rounded-full bg-cyan-500/10 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Company
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              The platform behind{" "}
              <span className="gradient-text-hero">digital services.</span>
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              MigraTeck builds the operating platform for digital services —
              identity, governance, execution, and distribution in one
              coordinated system.
            </p>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* origin */}
      <section className={ui.sectionPy}>
        <div className={cn(ui.maxWNarrow, "text-center")}>
          <p className={ui.eyebrowBrand}>Origin</p>
          <h2 className={cn(ui.h2, "mt-3")}>Started with hosting, grew into a platform.</h2>
          <p className={cn(ui.body, "mx-auto mt-4 max-w-xl")}>
            MigraTeck began with a single managed hosting product. As customers
            needed invoicing, communications, file management, and automation,
            we built each capability as a composable product inside a single
            ecosystem — rather than stitching together external tools.
          </p>
        </div>
      </section>

      {/* timeline – dark */}
      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 left-0 h-[300px] w-[300px] rounded-full bg-blue-500/10 blur-[80px]" />
        <div className={cn(ui.maxWNarrow, "relative py-20 sm:py-24")}>
          <p className={ui.eyebrowDark}>Timeline</p>
          <h2 className={cn(ui.h2Dark, "mt-3")}>Key milestones</h2>
          <div className="mt-10 space-y-6">
            {milestones.map((m) => (
              <div key={m.year} className="flex gap-6">
                <span className="shrink-0 font-[var(--font-display)] text-2xl font-bold text-sky-400">{m.year}</span>
                <p className="text-sm leading-6 text-slate-300 pt-1">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* principles */}
      <section className={cn(ui.sectionPy, "bg-slate-50/50")}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>How we operate</p>
          <h2 className={cn(ui.h2, "mt-3")}>Operating principles</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {principles.map((p, i) => (
              <div key={p.title} className={cn(ui.card, "p-6")}>
                <span className={ui.depthNum}>0{i + 1}</span>
                <h3 className={cn(ui.h3, "mt-3")}>{p.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* scale */}
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

      {/* CTA */}
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
