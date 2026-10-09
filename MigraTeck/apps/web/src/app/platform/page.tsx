import Link from "next/link";
import Image from "next/image";
import { productsByKey } from "@/data/products";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Platform",
  description:
    "The MigraTeck platform connects public entry, account access, governance, execution, and software distribution into one shared operating model.",
  path: "/platform",
});

const layers = [
  { name: "Public Surface", desc: "Pages for positioning, pricing, product discovery, and developer onboarding under one trust boundary." },
  { name: "Authenticated Surface", desc: "Organization-aware product entry, account context, and platform control paths." },
  { name: "Execution Layer", desc: "Provisioning, billing synchronization, access decisions, and deterministic workflow operations." },
  { name: "Distribution Layer", desc: "Downloads, artifacts, and release channels that keep source integrity and delivery posture visible." },
  { name: "Expansion Model", desc: "Downstream products plug into shared identity, governance, and orchestration instead of rebuilding platform concerns." },
] as const;

const transaction = [
  "User authenticates into MigraTeck and selects the relevant organization context.",
  "Platform services resolve entitlements, access scope, and policy requirements.",
  "The requested action is validated against governance rules before runtime work begins.",
  "Execution services trigger the correct workflow, provisioning job, or product-side operation.",
  "The connected product completes the task or queues the next managed execution step.",
  "Result state returns through the platform, API, or distribution channel with a consistent trust boundary.",
] as const;

const coreProducts = [
  productsByKey.migrateck,
  productsByKey.migrapanel,
  productsByKey.migrapilot,
] as const;

export default function PlatformPage() {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute -left-40 top-32 h-[500px] w-[500px] rounded-full bg-blue-500/20 blur-[120px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Platform architecture
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              The shared platform behind the MigraTeck ecosystem.
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              MigraTeck provides the common identity, governance, execution, and distribution
              systems that connect every product in the ecosystem. Instead of rebuilding
              platform concerns product by product, downstream services inherit one
              coordinated backbone.
            </p>
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-4">
              <Link href="/products" className={ui.btnPrimaryLight}>View products</Link>
              <Link href="/developers" className={ui.btnSecondaryDark}>Developer surface</Link>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Architecture layers</p>
          <h2 className={cn(ui.h2, "mt-4")}>From entry point to connected platform.</h2>
          <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {layers.map((layer, i) => (
              <div key={layer.name} className={cn(ui.card, "p-6")}>
                <div className={ui.depthNum}>{i + 1}</div>
                <div>
                  <h3 className="mt-4 font-[var(--font-display)] text-lg font-semibold tracking-tight text-white">
                    {layer.name}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-400">{layer.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn("border-t border-white/10", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className={ui.eyebrowBrand}>Platform transaction</p>
              <h2 className={cn(ui.h2, "mt-4")}>
                How the platform operates across the ecosystem.
              </h2>
              <p className={cn(ui.body, "mt-4")}>
                This operating flow shows how identity, governance, execution, and delivery work together through one shared platform.
              </p>
            </div>
            <div className="space-y-4">
              {transaction.map((step, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400">
                    {i + 1}
                  </div>
                  <p className="text-sm leading-6 text-slate-300">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 top-0 h-[400px] w-[300px] rounded-full bg-blue-600/15 blur-[100px]" />
        <div className={cn(ui.maxW, "relative py-24 sm:py-32")}>
          <p className={ui.eyebrowDark}>Platform core</p>
          <h2 className={cn(ui.h2Dark, "mt-4")}>Products connected to the runtime.</h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {coreProducts.map((p) => (
              <Link key={p.key} href={`/products/${p.slug}`} className={cn(ui.cardDark, ui.cardDarkHover, "block p-6")}>
                <div className="flex items-center gap-3">
                  <div className={cn(ui.logoBadgeDark, "overflow-hidden")}>
                    <Image src={p.logo} alt={p.name} fill sizes="40px" className="object-contain p-1" />
                  </div>
                  <h3 className="font-semibold text-white">{p.name}</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{p.shortDescription}</p>
                <p className="mt-3 text-sm font-medium text-sky-400">Learn more →</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
