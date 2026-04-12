import Link from "next/link";
import { products } from "@/data/products";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Developers",
  description:
    "Build on the MigraTeck platform with consistent APIs, typed contracts, shared authentication, and documented entry points.",
  path: "/developers",
});

const devPillars = [
  { title: "Unified authentication", desc: "One identity surface for every product. Token-based access with organization context and role-aware scoping." },
  { title: "Typed API contracts", desc: "Versioned endpoints with request validation, structured error responses, and consistent pagination patterns." },
  { title: "Platform webhooks", desc: "Event-driven notifications for provisioning, billing, and product state changes across the ecosystem." },
  { title: "Distribution SDKs", desc: "Official packages, CLI tools, and release artifacts delivered through verified distribution channels." },
] as const;

const startActions = [
  { title: "Read the API reference", desc: "Structured documentation for every platform endpoint with request examples and response schemas.", href: "/developers", label: "View docs" },
  { title: "Explore the registry", desc: "Browse all 10 products, their capabilities, and access patterns from the canonical product registry.", href: "/products", label: "View products" },
  { title: "Review security model", desc: "Understand the security architecture, threat protections, and responsible disclosure process.", href: "/security", label: "View security" },
] as const;

export default function DevelopersPage() {
  return (
    <>
      {/* hero */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute -right-40 top-40 h-[500px] w-[500px] rounded-full bg-cyan-400/20 blur-[120px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Developer platform
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              One platform,{" "}
              <span className="gradient-text-hero">consistent APIs.</span>
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              Build on shared identity, typed contracts, and documented entry points
              across {products.length} connected products.
            </p>
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-4">
              <Link href="/products" className={ui.btnPrimaryLight}>View products</Link>
              <Link href="/security" className={ui.btnSecondaryDark}>Security model</Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* developer pillars */}
      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Developer surface</p>
          <h2 className={cn(ui.h2, "mt-4")}>Built for integration.</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {devPillars.map((p, i) => (
              <div key={p.title} className={cn(ui.card, ui.cardHover, "p-6")}>
                <div className={ui.depthNum}>{i + 1}</div>
                <h3 className="mt-4 font-[var(--font-display)] text-lg font-semibold tracking-tight text-slate-950">
                  {p.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* API example */}
      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute left-0 top-0 h-[400px] w-[300px] rounded-full bg-blue-600/15 blur-[100px]" />
        <div className={cn(ui.maxW, "relative py-24 sm:py-32")}>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className={ui.eyebrowDark}>API example</p>
              <h2 className={cn(ui.h2Dark, "mt-4")}>Predictable request patterns.</h2>
              <p className={cn(ui.bodyDark, "mt-4")}>
                Every product exposes the same authentication, versioning, and error-handling patterns.
                Build one integration pattern and reuse it across the ecosystem.
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0f1e] shadow-2xl">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
                <span className="ml-3 text-xs text-slate-500">Terminal</span>
              </div>
              <pre className="overflow-x-auto p-5 text-[13px] leading-7">
                <code>
                  <span className="text-slate-500">POST</span>{" "}<span className="text-sky-400">/v1/products/access</span>{"\n"}
                  <span className="text-slate-500">Authorization:</span>{" "}<span className="text-emerald-400">Bearer mt_live_sk_...</span>{"\n"}
                  <span className="text-slate-500">Content-Type:</span>{" "}<span className="text-emerald-400">application/json</span>{"\n\n"}
                  <span className="text-slate-400">{"{"}</span>{"\n"}
                  {"  "}<span className="text-sky-300">{'"product"'}</span><span className="text-slate-400">:</span>{" "}<span className="text-amber-300">{'"migrahosting"'}</span><span className="text-slate-400">,</span>{"\n"}
                  {"  "}<span className="text-sky-300">{'"action"'}</span><span className="text-slate-400">:</span>{" "}<span className="text-amber-300">{'"provision"'}</span><span className="text-slate-400">,</span>{"\n"}
                  {"  "}<span className="text-sky-300">{'"org_id"'}</span><span className="text-slate-400">:</span>{" "}<span className="text-amber-300">{'"org_01H..."'}</span>{"\n"}
                  <span className="text-slate-400">{"}"}</span>
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* getting started */}
      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Start building</p>
          <h2 className={cn(ui.h2, "mt-4")}>Three paths into the platform.</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {startActions.map((a) => (
              <div key={a.title} className={cn(ui.card, "flex flex-col p-6")}>
                <h3 className="font-[var(--font-display)] text-lg font-semibold tracking-tight text-slate-950">
                  {a.title}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{a.desc}</p>
                <Link href={a.href} className="mt-5 text-sm font-medium text-blue-600 hover:text-blue-700">
                  {a.label} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
