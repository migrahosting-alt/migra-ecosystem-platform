import Image from "next/image";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Ecosystem",
  description:
    "Explore the MigraTeck ecosystem. Nine products — hosting, communication, billing, automation, and more — built to work as one platform.",
  path: "/portfolio",
});

const ecosystemProducts = [
  {
    name: "MigraHosting",
    logo: "/brands/products/migrahosting.png",
    description: "Infrastructure, deployment, and hosting for applications, services, and digital products.",
    accent: "from-blue-400/80 via-cyan-400/70 to-sky-400/70",
    href: "/products/migrahosting",
  },
  {
    name: "MigraPanel",
    logo: "/brands/products/migrapanel.png",
    description: "Unified control for products, services, customer access, and operational management.",
    accent: "from-violet-400/80 via-indigo-400/70 to-blue-400/70",
    href: "/products/migrapanel",
  },
  {
    name: "MigraVoice",
    logo: "/brands/products/migravoice.png",
    description: "Communication systems for voice, calls, and connected customer interaction flows.",
    accent: "from-fuchsia-400/80 via-pink-400/70 to-violet-400/70",
    href: "/products/migravoice",
  },
  {
    name: "MigraMail",
    logo: "/brands/products/migramail.png",
    description: "Email delivery, messaging infrastructure, and coordinated communication services.",
    accent: "from-cyan-400/80 via-sky-400/70 to-blue-400/70",
    href: "/products/migramail",
  },
  {
    name: "MigraIntake",
    logo: "/brands/products/migraintake.png",
    description: "Client intake, onboarding, submissions, and guided workflow collection systems.",
    accent: "from-emerald-400/80 via-teal-400/70 to-cyan-400/70",
    href: "/products/migraintake",
  },
  {
    name: "MigraMarketing",
    logo: "/brands/products/migramarketing.png",
    description: "Campaign, outreach, and growth tooling designed to connect marketing with operations.",
    accent: "from-amber-300/80 via-pink-400/70 to-fuchsia-400/70",
    href: "/products/migramarketing",
  },
  {
    name: "MigraDrive",
    logo: "/brands/products/migradrive.png",
    description: "Storage, file access, and secure distribution for teams, products, and customers.",
    accent: "from-sky-400/80 via-blue-400/70 to-indigo-400/70",
    href: "/products/migradrive",
  },
  {
    name: "MigraPilot",
    logo: "/brands/products/migrapilot.png",
    description: "Operational guidance, automation, and intelligent control across the ecosystem.",
    accent: "from-violet-400/80 via-fuchsia-400/70 to-blue-400/70",
    href: "/products/migrapilot",
  },
  {
    name: "MigraInvoice",
    logo: "/brands/products/migrainvoice.png",
    description: "Billing, invoicing, payment coordination, and revenue workflows for modern businesses.",
    accent: "from-lime-300/80 via-emerald-400/70 to-sky-400/70",
    href: "/products/migrainvoice",
  },
] as const;

const platformLayers = [
  {
    title: "Identity and access",
    description:
      "User identity, permissions, and entry points stay coordinated across the ecosystem instead of being split across disconnected tools.",
  },
  {
    title: "Products and services",
    description:
      "Applications, product offers, service paths, and customer experiences operate as part of one platform company.",
  },
  {
    title: "Hosting and delivery",
    description:
      "Infrastructure, deployment, and distribution are connected to the same business system that powers the products themselves.",
  },
  {
    title: "Communication and billing",
    description:
      "Voice, email, intake, and payment workflows support the full customer journey instead of living in separate vendor silos.",
  },
] as const;

const proofItems = [
  "Unified ecosystem architecture",
  "Connected products and services",
  "Operational infrastructure",
  "Communication and intake systems",
  "Billing and business workflows",
] as const;

const liveUseCases = [
  {
    title: "Software delivery",
    description:
      "Deploy and distribute applications, services, and digital experiences through connected infrastructure.",
  },
  {
    title: "Client operations",
    description:
      "Manage intake, communication, and access from the same ecosystem used to deliver products.",
  },
  {
    title: "Commercial workflows",
    description:
      "Support pricing, invoicing, payments, and service operations through one coordinated platform.",
  },
] as const;

function ProductCard({
  product,
  featured = false,
}: {
  product: (typeof ecosystemProducts)[number];
  featured?: boolean;
}) {
  return (
    <Link
      href={product.href}
      className={`group relative overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.07] no-underline flex flex-col ${
        featured ? "md:col-span-2 md:min-h-[220px]" : "min-h-[220px]"
      }`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${product.accent} opacity-[0.06] transition duration-300 group-hover:opacity-[0.1]`}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-60" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-white/12 bg-white/8 p-2">
            <Image src={product.logo} alt={product.name} fill sizes="48px" className="object-contain p-0.5" />
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/45">
            Product
          </div>
        </div>

        <div className="mt-5">
          <h3 className={`font-semibold tracking-[-0.03em] text-white ${featured ? "text-2xl" : "text-xl"}`}>
            {product.name}
          </h3>
          <p className={`mt-3 max-w-[52ch] text-sm leading-7 text-white/68 ${featured ? "md:text-[15px]" : ""}`}>
            {product.description}
          </p>
        </div>

        <div className="mt-auto pt-6">
          <div className={`h-1.5 rounded-full bg-gradient-to-r ${product.accent} opacity-90`} />
        </div>
      </div>
    </Link>
  );
}

function SectionIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-[760px]">
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/85">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white md:text-5xl">{title}</h2>
      <p className="mt-5 max-w-[700px] text-base leading-8 text-white/68 md:text-lg">{description}</p>
    </div>
  );
}

export default function MigraTeckPortfolioPage() {
  const featuredProduct = ecosystemProducts[0];
  const remainingProducts = ecosystemProducts.slice(1);

  return (
    <main className="relative overflow-hidden bg-[#071121] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_14%,rgba(59,130,246,0.22),transparent_30%),radial-gradient(circle_at_86%_16%,rgba(99,102,241,0.14),transparent_24%),linear-gradient(180deg,rgba(16,45,120,0.30),rgba(7,17,33,1)_26%,rgba(6,12,24,1)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_12%,transparent_88%,rgba(255,255,255,0.02))]" />
      <div className="absolute left-[-8rem] top-40 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="absolute right-[-8rem] top-[28rem] h-[28rem] w-[28rem] rounded-full bg-violet-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1280px] px-6 pb-24 pt-24 md:px-8 lg:px-10">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="grid items-center gap-14 pb-24 pt-4 lg:grid-cols-12 lg:gap-10 lg:pb-32">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/90">
              MigraTeck ecosystem
            </div>

            <h1 className="mt-6 max-w-[760px] text-5xl font-semibold leading-[0.98] tracking-[-0.05em] text-white md:text-6xl lg:text-7xl">
              Explore the products, infrastructure, and services behind MigraTeck.
            </h1>

            <p className="mt-6 max-w-[600px] text-base leading-8 text-white/68 md:text-lg">
              Everything we build works as one unified platform — connecting identity, hosting, communication, product delivery, and business operations into one coordinated ecosystem.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="#products"
                className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400"
              >
                Explore products
              </a>
              <a
                href="#platform"
                className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/82 transition hover:bg-white/8"
              >
                View platform
              </a>
            </div>

            <div className="mt-10 h-px w-full max-w-[600px] bg-gradient-to-r from-white/20 via-white/10 to-transparent" />

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm text-white/45 md:gap-x-6">
              {proofItems.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-300/70" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hero right panel */}
          <div className="lg:col-span-6 lg:pl-4">
            <div className="relative mx-auto max-w-[560px]">
              <div className="absolute -inset-10 bg-blue-500/8 blur-3xl" />
              <div className="relative rounded-[32px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-2xl md:p-6">
                <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-[linear-gradient(135deg,rgba(255,255,255,0.10),rgba(255,255,255,0.02)_30%,rgba(59,130,246,0.08)_100%)]" />

                <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#0F172A]/80 p-5 md:p-6">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.10),transparent_30%)]" />
                  <div className="absolute left-1/2 top-[48%] h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.26),rgba(59,130,246,0.15),transparent_68%)] blur-2xl" />

                  <div className="relative flex items-start justify-between gap-4 border-b border-white/8 pb-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-white/38">Ecosystem overview</p>
                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">One company. Connected products.</h2>
                    </div>
                    <div className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-200/90">
                      Unified
                    </div>
                  </div>

                  {/* MigraTeck anchor */}
                  <div className="relative mt-5 rounded-[20px] border border-white/12 bg-white/[0.06] p-4">
                    <div className="flex items-center gap-3">
                      <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-white/15 bg-white/10 p-1.5">
                        <Image src="/brands/products/migrateck-official.png" alt="MigraTeck" fill sizes="40px" className="object-contain" />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.24em] text-white/38">Platform</p>
                        <p className="mt-0.5 text-base font-semibold tracking-[-0.02em] text-white">MigraTeck</p>
                      </div>
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-blue-400/60 via-indigo-400/40 to-fuchsia-400/30" />
                  </div>

                  {/* Product grid in panel */}
                  <div className="relative mt-3 grid grid-cols-2 gap-2.5">
                    {ecosystemProducts.slice(0, 8).map((product) => (
                      <div
                        key={product.name}
                        className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 transition duration-300 hover:border-white/18 hover:bg-white/[0.07]"
                      >
                        <div className={`absolute inset-0 bg-gradient-to-br ${product.accent} opacity-[0.05] transition duration-300 group-hover:opacity-[0.09]`} />
                        <div className="relative flex items-center gap-2.5">
                          <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded-lg border border-white/12 bg-white/8">
                            <Image src={product.logo} alt={product.name} fill sizes="24px" className="object-contain p-0.5" />
                          </div>
                          <p className="truncate text-[12px] font-medium text-white/85">{product.name}</p>
                        </div>
                        <div className={`mt-2.5 h-1 rounded-full bg-gradient-to-r ${product.accent} opacity-80`} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Products ─────────────────────────────────────────── */}
        <section id="products" className="border-t border-white/8 py-24">
          <SectionIntro
            eyebrow="Products"
            title="A connected ecosystem, not separate tools."
            description="Each MigraTeck product is designed to work on its own — and even better together as part of the broader platform."
          />

          <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <ProductCard product={featuredProduct} featured />
            {remainingProducts.map((product) => (
              <ProductCard key={product.name} product={product} />
            ))}
          </div>
        </section>

        {/* ── Platform ─────────────────────────────────────────── */}
        <section id="platform" className="border-t border-white/8 py-24">
          <SectionIntro
            eyebrow="Platform"
            title="One platform. Multiple capabilities."
            description="MigraTeck is built so identity, product access, infrastructure, communication, and business operations all support the same company system."
          />

          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            {platformLayers.map((layer) => (
              <div
                key={layer.title}
                className="rounded-[28px] border border-white/10 bg-white/[0.04] p-7 backdrop-blur-xl"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-blue-400/20 bg-blue-400/10 text-xs font-semibold text-blue-200">
                    +
                  </span>
                  <h3 className="text-xl font-semibold tracking-[-0.03em] text-white">{layer.title}</h3>
                </div>
                <p className="mt-5 max-w-[60ch] text-sm leading-7 text-white/68 md:text-[15px]">
                  {layer.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="border-t border-white/8 py-24">
          <div className="grid gap-14 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-5">
              <SectionIntro
                eyebrow="How it works"
                title="Everything works together by design."
                description="Every MigraTeck product is part of the same platform — so businesses don't have to stitch identity, hosting, delivery, communication, and operations together from disconnected vendors."
              />
            </div>

            <div className="lg:col-span-7">
              <div className="relative rounded-[32px] border border-white/10 bg-white/[0.045] p-6 backdrop-blur-2xl">
                <div className="absolute inset-0 rounded-[32px] bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.12),transparent_52%)] pointer-events-none" />
                <div className="relative">
                  {/* Center anchor */}
                  <div className="mb-4 rounded-[24px] border border-white/10 bg-white/[0.05] p-5 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/10 p-2">
                      <Image src="/brands/products/migrateck-official.png" alt="MigraTeck" width={40} height={40} className="object-contain" />
                    </div>
                    <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">MigraTeck Platform</h3>
                    <p className="mx-auto mt-2 max-w-[44ch] text-sm leading-7 text-white/60">
                      A unified company system connecting product experiences, infrastructure, communication, and business workflows.
                    </p>
                  </div>

                  {/* Product chips */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {ecosystemProducts.slice(0, 6).map((product) => (
                      <div
                        key={product.name}
                        className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
                      >
                        <div className="relative h-7 w-7 overflow-hidden rounded-lg border border-white/12 bg-white/8">
                          <Image src={product.logo} alt={product.name} fill sizes="28px" className="object-contain p-0.5" />
                        </div>
                        <div className="mt-3 text-sm font-medium tracking-[-0.01em] text-white/88">{product.name}</div>
                        <div className={`mt-3 h-1 rounded-full bg-gradient-to-r ${product.accent} opacity-80`} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Reality / proof ──────────────────────────────────── */}
        <section className="border-t border-white/8 py-24">
          <SectionIntro
            eyebrow="Reality"
            title="Built and ready to use."
            description="MigraTeck is not presented as a loose concept. The ecosystem is designed to support real software delivery, client operations, communication systems, and commercial workflows."
          />

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {liveUseCases.map((item, index) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-white/10 bg-white/[0.04] p-7 backdrop-blur-xl"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-400/20 bg-blue-400/10 text-sm font-semibold text-blue-200">
                  {index + 1}
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-white">{item.title}</h3>
                <p className="mt-4 text-sm leading-7 text-white/68 md:text-[15px]">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="border-t border-white/8 pt-24">
          <div className="rounded-[36px] border border-white/10 bg-white/[0.05] px-6 py-12 text-center backdrop-blur-2xl md:px-10 md:py-16">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/85">Get started</p>
            <h2 className="mx-auto mt-4 max-w-[820px] text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">
              Start building with MigraTeck.
            </h2>
            <p className="mx-auto mt-5 max-w-[700px] text-base leading-8 text-white/68 md:text-lg">
              Explore the platform, discover the ecosystem, and see how MigraTeck brings products, infrastructure, and services together as one company system.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400"
              >
                Create account
              </Link>
              <Link
                href="/platform"
                className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/82 transition hover:bg-white/8"
              >
                Explore platform
              </Link>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
