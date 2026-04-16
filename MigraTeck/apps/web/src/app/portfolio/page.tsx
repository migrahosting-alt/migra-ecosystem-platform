import Image from "next/image";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Ecosystem",
  description:
    "Explore the MigraTeck ecosystem. Nine products — hosting, communication, billing, automation, and more — built to work as one platform.",
  path: "/portfolio",
});

const products = [
  {
    name: "MigraHosting",
    purpose: "Infrastructure and deployment for applications and services.",
    accent: "from-indigo-400/80 via-violet-400/70 to-blue-400/70",
    logo: "/brands/products/migrahosting.png",
    href: "/products/migrahosting",
  },
  {
    name: "MigraPanel",
    purpose: "Product and service management across your organization.",
    accent: "from-blue-400/80 via-sky-400/70 to-cyan-400/70",
    logo: "/brands/products/migrapanel.png",
    href: "/products/migrapanel",
  },
  {
    name: "MigraVoice",
    purpose: "Voice communication layer — calls, trunks, and telephony.",
    accent: "from-fuchsia-400/80 via-pink-400/70 to-violet-400/70",
    logo: "/brands/products/migravoice.png",
    href: "/products/migravoice",
  },
  {
    name: "MigraMail",
    purpose: "Email and messaging infrastructure for teams and customers.",
    accent: "from-cyan-400/80 via-sky-400/70 to-blue-400/70",
    logo: "/brands/products/migramail.png",
    href: "/products/migramail",
  },
  {
    name: "MigraIntake",
    purpose: "Client intake and onboarding workflows.",
    accent: "from-lime-300/80 via-emerald-400/70 to-cyan-400/70",
    logo: "/brands/products/migraintake.png",
    href: "/products/migraintake",
  },
  {
    name: "MigraMarketing",
    purpose: "Growth campaigns, outreach, and marketing automation.",
    accent: "from-rose-400/80 via-pink-400/70 to-fuchsia-400/70",
    logo: "/brands/products/migramarketing.png",
    href: "/products/migramarketing",
  },
  {
    name: "MigraDrive",
    purpose: "File storage and distribution for teams and clients.",
    accent: "from-emerald-400/80 via-teal-400/70 to-blue-400/70",
    logo: "/brands/products/migradrive.png",
    href: "/products/migradrive",
  },
  {
    name: "MigraPilot",
    purpose: "Automation, workflows, and intelligent task execution.",
    accent: "from-amber-300/80 via-orange-400/70 to-yellow-400/70",
    logo: "/brands/products/migrapilot.png",
    href: "/products/migrapilot",
  },
  {
    name: "MigraInvoice",
    purpose: "Billing, invoicing, and payment processing.",
    accent: "from-violet-400/80 via-purple-400/70 to-fuchsia-400/70",
    logo: "/brands/products/migrainvoice.png",
    href: "/products/migrainvoice",
  },
] as const;

const capabilities = [
  {
    layer: "Identity",
    description: "One access layer connects users, organizations, and permissions across every product.",
    icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z",
  },
  {
    layer: "Hosting",
    description: "Infrastructure that delivers applications, environments, and services at scale.",
    icon: "M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7",
  },
  {
    layer: "Communication",
    description: "Voice, email, and messaging built into the platform — not bolted on after.",
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  },
  {
    layer: "Billing",
    description: "Payments, invoicing, and subscription logic that works across all products.",
    icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  },
] as const;

export default function PortfolioPage() {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 top-20 h-[500px] w-[400px] rounded-full bg-cyan-400/15 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Ecosystem
            </p>
            <h1 className="mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Explore the MigraTeck ecosystem.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300/90">
              Everything we build — products, infrastructure, and services — working as one unified platform. MigraTeck connects identity, hosting, communication, and product delivery into a single coordinated system designed for real software businesses.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/products" className={ui.btnPrimaryLight}>Explore products</Link>
              <Link href="/platform" className={ui.btnSecondaryDark}>View platform</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Product grid ───────────────────────────────────────── */}
      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div className="max-w-2xl">
            <p className={ui.eyebrowBrand}>Products</p>
            <h2 className={cn(ui.h2, "mt-4")}>A connected ecosystem, not separate tools.</h2>
            <p className={cn(ui.body, "mt-4")}>
              Each MigraTeck product is designed to work independently — and even better together.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <Link
                key={product.name}
                href={product.href}
                className={cn(ui.card, ui.cardHover, "group flex flex-col p-6 no-underline")}
              >
                <div className="flex items-start gap-4">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-white/12 bg-white/8 p-2">
                    <Image
                      src={product.logo}
                      alt={product.name}
                      fill
                      sizes="48px"
                      className="object-contain p-0.5"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight text-white">{product.name}</p>
                    <p className="mt-1.5 text-sm leading-6 text-slate-400">{product.purpose}</p>
                  </div>
                </div>
                <div className={cn("mt-5 h-1 rounded-full bg-gradient-to-r opacity-70 transition group-hover:opacity-100", product.accent)} />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platform capabilities ──────────────────────────────── */}
      <section className={cn("border-t border-white/10", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
            <div>
              <p className={ui.eyebrowBrand}>Platform</p>
              <h2 className={cn(ui.h2, "mt-4")}>One platform. Multiple capabilities.</h2>
              <p className={cn(ui.body, "mt-4")}>
                Every product connects through the same foundation, so businesses don&apos;t have to stitch tools together. The platform handles identity, infrastructure, communication, and billing as a single coordinated system.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/platform" className={ui.btnPrimaryLight}>Explore the platform</Link>
                <Link href="/pricing" className={ui.btnSecondaryDark}>See pricing</Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {capabilities.map((cap) => (
                <div key={cap.layer} className={cn(ui.card, "p-6")}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-white/8">
                    <svg className="h-5 w-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={cap.icon} />
                    </svg>
                  </div>
                  <h3 className={cn(ui.h3, "mt-4")}>{cap.layer}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{cap.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Platform composition visual ───────────────────────── */}
      <section className={cn("border-t border-white/10", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 sm:p-12">
            <div className="max-w-xl">
              <p className={ui.eyebrowBrand}>How it works</p>
              <h2 className={cn(ui.h2, "mt-4")}>Everything works together by design.</h2>
              <p className={cn(ui.body, "mt-4")}>
                MigraTeck is the center. Products orbit it — each with its own function, all sharing the same identity, billing, and access layer. You get a full platform without the integration overhead.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              {/* Center hub */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-5 py-3.5">
                <div className="relative h-8 w-8 overflow-hidden rounded-xl border border-white/15 bg-white/10 p-1">
                  <Image src="/brands/products/migrateck-official.png" alt="MigraTeck" fill sizes="32px" className="object-contain" />
                </div>
                <span className="text-sm font-semibold text-white">MigraTeck</span>
              </div>

              <svg className="h-5 w-5 shrink-0 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>

              {/* Product chips */}
              <div className="flex flex-wrap gap-2">
                {products.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">
                    <div className="relative h-4 w-4 overflow-hidden rounded-md">
                      <Image src={p.logo} alt={p.name} fill sizes="16px" className="object-contain" />
                    </div>
                    <span className="text-xs font-medium text-white/75">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────── */}
      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Start building with MigraTeck.</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            Pick the products you need. Add more as you grow. Everything runs on the same platform.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/signup" className={ui.btnPrimaryLight}>Create account</Link>
            <Link href="/platform" className={ui.btnSecondaryDark}>Explore platform</Link>
          </div>
        </div>
      </section>
    </>
  );
}