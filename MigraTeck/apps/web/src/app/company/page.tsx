import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Company",
  description:
    "MigraTeck builds connected software products for identity, hosting, communications, workflow, billing, storage, automation, and distribution.",
  path: "/company",
});

const companySections = [
  { title: "Platform-first by design", desc: "MigraTeck operates as a connected company system where products, services, access, and delivery fit into the same operating model instead of running as separate properties." },
  { title: "Clear product roles", desc: "Each product in the ecosystem has a defined responsibility. Identity, governance, billing, and distribution are shared foundations, not rebuilt per product." },
  { title: "Commercial and technical alignment", desc: "Products, pricing, and services are organized under one narrative structure so the public story matches the actual platform model behind it." },
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
              MigraTeck builds connected software products for operations, access, communications, and delivery.
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              What began with infrastructure delivery expanded into a broader ecosystem of
              connected products. Today MigraTeck operates as a platform-first business
              that brings identity, governance, hosting, communications, workflow, billing,
              storage, automation, and distribution into one organized system.
            </p>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="grid gap-6 md:grid-cols-3">
            {companySections.map((section, index) => (
              <div key={section.title} className={cn(ui.card, ui.cardHover, "p-6")}>
                <p className={ui.eyebrowBrand}>Company view 0{index + 1}</p>
                <h2 className={cn(ui.h3, "mt-3")}>{section.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-400">{section.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 left-0 h-[300px] w-[300px] rounded-full bg-blue-500/10 blur-[80px]" />
        <div className={cn(ui.maxWNarrow, "relative py-20 sm:py-24")}>
          <p className={ui.eyebrowDark}>Origin</p>
          <h2 className={cn(ui.h2Dark, "mt-3")}>Infrastructure first. Platform second. Built to serve modern software businesses.</h2>
          <div className="mt-10 space-y-6">
            <p className="text-base leading-8 text-slate-300">
              MigraTeck began with managed infrastructure delivery through MigraHosting
              and expanded into a broader ecosystem spanning communications, automation,
              storage, billing, onboarding, and operational control.
            </p>
            <p className="text-base leading-8 text-slate-300">
              As the platform grew, the business adopted a shared backbone so products
              could operate together instead of as disconnected systems.
            </p>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "border-t border-white/10")}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>How we operate</p>
          <h2 className={cn(ui.h2, "mt-3")}>Operating principles</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {operatingPrinciples.map((p, i) => (
              <div key={p.title} className={cn(ui.card, "p-6")}>
                <span className={ui.depthNum}>0{i + 1}</span>
                <h3 className={cn(ui.h3, "mt-3")}>{p.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{p.desc}</p>
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
                <p className="font-[var(--font-display)] text-5xl font-bold text-blue-400">{num}</p>
                <p className="mt-2 text-sm text-slate-400">{label}</p>
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
