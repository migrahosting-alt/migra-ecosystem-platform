import Link from "next/link";
import Image from "next/image";
import { productsByKey } from "@/data/products";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Platform Architecture",
  description:
    "MigraTeck is structured as seven coordinated architecture layers: identity, governance, execution, product runtime, API access, distribution, and control plane.",
  path: "/platform",
});

const layers = [
  { name: "Identity Layer", desc: "Authentication, organization context, role-aware access, and future step-up enforcement across all products." },
  { name: "Policy Layer", desc: "Governance rules, entitlements, and operational policies evaluated before any action executes." },
  { name: "Execution Engine", desc: "Provisioning, orchestration, and workflow execution through deterministic platform-managed actions." },
  { name: "Product Runtime", desc: "Official products operate as modules inside the larger platform model instead of standalone experiences." },
  { name: "API Layer", desc: "Versioned service entry points expose platform capabilities through typed contracts and controlled request handling." },
  { name: "Distribution Layer", desc: "Downloads, SDKs, plugins, and release channels sit behind verified-source and access-aware controls." },
  { name: "Control Plane", desc: "Product routing, access governance, system visibility, and the primary operating surface for the ecosystem." },
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
      {/* hero */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute -left-40 top-32 h-[500px] w-[500px] rounded-full bg-blue-500/20 blur-[120px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Platform architecture
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Seven layers,<br />
              <span className="gradient-text-hero">one architecture.</span>
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              Identity, governance, execution, API access, product runtime, and
              distribution are treated as one architecture instead of disconnected systems.
            </p>
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-4">
              <Link href="/products" className={ui.btnPrimaryLight}>View products</Link>
              <Link href="/developers" className={ui.btnSecondaryDark}>Developer surface</Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* architecture layers */}
      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Architecture layers</p>
          <h2 className={cn(ui.h2, "mt-4")}>From identity to distribution.</h2>
          <div className="mt-12 grid gap-4">
            {layers.map((layer, i) => (
              <div key={layer.name} className={cn(ui.card, "flex items-start gap-5 p-5 sm:p-6")}>
                <div className={ui.depthNum}>{i + 1}</div>
                <div>
                  <h3 className="font-[var(--font-display)] text-lg font-semibold tracking-tight text-slate-950">
                    {layer.name}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">{layer.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* transaction flow */}
      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className={ui.eyebrowBrand}>Platform transaction</p>
              <h2 className={cn(ui.h2, "mt-4")}>
                A real request path, not abstract language.
              </h2>
              <p className={cn(ui.body, "mt-4")}>
                This is the operating sequence the rest of the site describes. It turns
                the control plane from positioning into a concrete execution model.
              </p>
            </div>
            <div className="space-y-4">
              {transaction.map((step, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-600">
                    {i + 1}
                  </div>
                  <p className="text-sm leading-6 text-slate-700">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* core platform products */}
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
