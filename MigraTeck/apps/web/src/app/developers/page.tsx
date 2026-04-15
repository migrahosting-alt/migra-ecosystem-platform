import Link from "next/link";
import { products } from "@/data/products";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Developers",
  description:
    "Build on the MigraTeck platform with deliberate route groups, shared identity, and platform-aware developer entry.",
  path: "/developers",
});

const devPillars = [
  { title: "Security defaults", desc: "Shared authentication, policy-aware access, request validation, and platform-level protections instead of route-by-route improvisation." },
  { title: "Launch bridge", desc: "A signed handoff path from the public platform surface into downstream product experiences and controlled access flows." },
  { title: "API domains", desc: "Platform capabilities are grouped by responsibility so the developer surface reads as a deliberate system instead of a mixed route collection." },
  { title: "Tenant context", desc: "Core account and organization context remain shared across the ecosystem, keeping integrations and access posture consistent." },
] as const;

const systemTracks = [
  { title: "Shared auth model", desc: "One platform identity layer across products and launch surfaces." },
  { title: "Versioned routes", desc: "Predictable request patterns for product, account, and platform operations." },
  { title: "Distribution posture", desc: "Downloads, artifacts, and tooling move through one verified delivery surface." },
] as const;

export default function DevelopersPage() {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute -right-40 top-40 h-[500px] w-[500px] rounded-full bg-cyan-400/20 blur-[120px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Developer platform
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              A developer surface that looks as deliberate as the backend behind it.
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              Build on shared identity, deliberate route groups, and platform-aware developer entry across {products.length} connected products.
            </p>
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-4">
              <Link href="/products" className={ui.btnPrimaryLight}>View products</Link>
              <Link href="/security" className={ui.btnSecondaryDark}>Security model</Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Developer surface</p>
          <h2 className={cn(ui.h2, "mt-4")}>Built for integration and control.</h2>
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

      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute left-0 top-0 h-[400px] w-[300px] rounded-full bg-blue-600/15 blur-[100px]" />
        <div className={cn(ui.maxW, "relative py-24 sm:py-32")}>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className={ui.eyebrowDark}>System posture</p>
              <h2 className={cn(ui.h2Dark, "mt-4")}>Predictable request patterns.</h2>
              <p className={cn(ui.bodyDark, "mt-4")}>
                The point of the developer page is not just to show endpoints. It should communicate that the platform has a coherent execution model, consistent access posture, and one integration rhythm across products.
              </p>
              <div className="mt-8 grid gap-3">
                {systemTracks.map((track) => (
                  <div key={track.title} className={cn(ui.cardDark, "p-4")}>
                    <p className="text-sm font-semibold text-white">{track.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{track.desc}</p>
                  </div>
                ))}
              </div>
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

      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Start building</p>
          <h2 className={cn(ui.h2, "mt-4")}>Three paths into the platform.</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
              { title: "Explore the registry", desc: "Browse the canonical product set and see how access and capability posture vary across the ecosystem.", href: "/products", label: "View products" },
              { title: "Review platform architecture", desc: "Understand how identity, governance, execution, and distribution sit together as one system.", href: "/platform", label: "View platform" },
              { title: "Check the security model", desc: "Review the trust posture, protection layers, and responsible disclosure expectations for the site and platform.", href: "/security", label: "View security" },
            ].map((a) => (
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
