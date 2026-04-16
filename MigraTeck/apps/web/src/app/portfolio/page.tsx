import Image from "next/image";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Ecosystem",
  description:
    "Explore the MigraTeck ecosystem — products, infrastructure, and services working as one unified platform.",
  path: "/portfolio",
});

const ecosystemHighlights = [
  {
    title: "Connected products",
    description:
      "MigraTeck products are designed to work independently and as part of one larger platform system.",
  },
  {
    title: "Operational infrastructure",
    description:
      "Hosting, delivery, access, communication, and business workflows are coordinated instead of fragmented.",
  },
  {
    title: "Built for real use",
    description:
      "The ecosystem is positioned for software businesses that need products, services, and infrastructure to move together.",
  },
] as const;

const allProducts = [
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
    description: "Unified control for products, services, access, and operational management.",
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

const platformPillars = [
  {
    title: "Identity and access",
    description:
      "Users, permissions, and entry points stay coordinated across the ecosystem instead of being split across separate systems.",
  },
  {
    title: "Products and services",
    description:
      "Applications, service paths, and customer experiences operate inside one organized company platform.",
  },
  {
    title: "Hosting and delivery",
    description:
      "Infrastructure and software distribution connect directly to the same business system that powers the products.",
  },
  {
    title: "Communication and operations",
    description:
      "Voice, email, intake, and business workflows support the full customer journey as part of one coordinated stack.",
  },
] as const;

const useCases = [
  {
    title: "Launch products with infrastructure already connected",
    description:
      "Instead of stitching together hosting, access, communication, and delivery from multiple vendors, businesses can build inside one system.",
  },
  {
    title: "Operate services and customer workflows together",
    description:
      "Intake, messaging, support paths, and operational workflows stay aligned with the platform products customers actually use.",
  },
  {
    title: "Grow on a platform that stays coherent",
    description:
      "Commercial, technical, and customer-facing systems remain connected as the company expands its products and services.",
  },
] as const;

function SectionIntro({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  description: string;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-[860px] text-center" : "max-w-[760px]"}>
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/85">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white md:text-5xl">{title}</h2>
      <p className="mt-5 text-base leading-8 text-white/68 md:text-lg">{description}</p>
    </div>
  );
}

function ProductCard({
  product,
}: {
  product: (typeof allProducts)[number];
}) {
  return (
    <Link
      href={product.href}
      className="group relative flex flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.045] p-5 no-underline backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.07]"
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${product.accent} opacity-[0.05] transition duration-300 group-hover:opacity-[0.09]`}
      />
      <div className="relative flex items-start justify-between gap-4">
        <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-white/12 bg-white/8 p-2">
          <Image src={product.logo} alt={product.name} fill sizes="48px" className="object-contain p-0.5" />
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/45">
          Product
        </div>
      </div>
      <h3 className="relative mt-5 text-xl font-semibold tracking-[-0.03em] text-white">{product.name}</h3>
      <p className="relative mt-3 flex-1 text-sm leading-7 text-white/68">{product.description}</p>
      <div className={`relative mt-6 h-1.5 rounded-full bg-gradient-to-r ${product.accent} opacity-90`} />
    </Link>
  );
}

export default function MigraTeckPortfolioPage() {
  const panelProducts = allProducts.slice(0, 8);

  return (
    <main className="relative overflow-hidden bg-[#071121] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_32%),radial-gradient(circle_at_84%_20%,rgba(99,102,241,0.16),transparent_26%),linear-gradient(180deg,rgba(20,50,132,0.30),rgba(7,17,33,1)_24%,rgba(5,10,20,1)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_12%,transparent_88%,rgba(255,255,255,0.02))]" />
      <div className="absolute left-[-10rem] top-32 h-[30rem] w-[30rem] rounded-full bg-blue-500/10 blur-3xl" />
      <div className="absolute right-[-8rem] top-[24rem] h-[28rem] w-[28rem] rounded-full bg-violet-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1280px] px-6 pb-24 pt-24 md:px-8 lg:px-10">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="grid items-center gap-16 pb-24 pt-8 lg:grid-cols-12 lg:gap-10 lg:pb-32">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/90">
              Unified software platform
            </div>

            <h1 className="mt-6 max-w-[780px] text-5xl font-semibold leading-[0.98] tracking-[-0.05em] text-white md:text-6xl lg:text-7xl">
              Products, infrastructure, and business systems — working as one company platform.
            </h1>

            <p className="mt-6 max-w-[620px] text-base leading-8 text-white/68 md:text-lg">
              MigraTeck connects hosting, access, communication, delivery, and operations into one coordinated ecosystem designed for serious software businesses.
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

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {ecosystemHighlights.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl"
                >
                  <div className="text-[11px] uppercase tracking-[0.24em] text-blue-200/80">Highlight</div>
                  <h3 className="mt-3 text-base font-semibold tracking-[-0.02em] text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-white/64">{item.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Hero right panel */}
          <div className="lg:col-span-6 lg:pl-4">
            <div className="relative mx-auto max-w-[580px]">
              <div className="absolute -inset-10 bg-blue-500/10 blur-3xl" />
              <div className="relative rounded-[34px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-2xl md:p-6">
                <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[linear-gradient(135deg,rgba(255,255,255,0.10),rgba(255,255,255,0.02)_30%,rgba(59,130,246,0.08)_100%)]" />
                <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#0F172A]/80 p-5 md:p-6">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.10),transparent_30%)]" />
                  <div className="absolute left-1/2 top-[46%] h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.26),rgba(59,130,246,0.14),transparent_68%)] blur-2xl" />

                  <div className="relative flex items-start justify-between gap-4 border-b border-white/8 pb-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-white/38">Connected product system</p>
                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">One company. Connected capabilities.</h2>
                    </div>
                    <div className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-200/90">
                      Live
                    </div>
                  </div>

                  {/* MigraTeck anchor */}
                  <div className="relative mt-5 overflow-hidden rounded-[20px] border border-white/12 bg-white/[0.06] px-4 py-4">
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
                    {panelProducts.map((product) => (
                      <div
                        key={product.name}
                        className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 transition duration-300 hover:border-white/18 hover:bg-white/[0.07]"
                      >
                        <div
                          className={`absolute inset-0 bg-gradient-to-br ${product.accent} opacity-[0.05] transition duration-300 group-hover:opacity-[0.09]`}
                        />
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
            title="The ecosystem customers encounter is built to stay connected."
            description="MigraTeck products are not presented as disconnected apps. They are part of one larger system designed to support delivery, operations, and customer experience together."
          />

          <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {allProducts.map((product) => (
              <ProductCard key={product.name} product={product} />
            ))}
          </div>
        </section>

        {/* ── Platform ─────────────────────────────────────────── */}
        <section id="platform" className="border-t border-white/8 py-24">
          <SectionIntro
            eyebrow="Platform"
            title="MigraTeck is structured as one company system."
            description="The platform is organized so identity, products, infrastructure, communication, and operations reinforce each other instead of being spread across disconnected layers."
          />

          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            {platformPillars.map((pillar) => (
              <div
                key={pillar.title}
                className="rounded-[28px] border border-white/10 bg-white/[0.04] p-7 backdrop-blur-xl"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-blue-400/20 bg-blue-400/10 text-xs font-semibold text-blue-200">
                    +
                  </span>
                  <h3 className="text-xl font-semibold tracking-[-0.03em] text-white">{pillar.title}</h3>
                </div>
                <p className="mt-5 text-sm leading-7 text-white/68 md:text-[15px]">{pillar.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Why it matters ───────────────────────────────────── */}
        <section className="border-t border-white/8 py-24">
          <SectionIntro
            eyebrow="Why it matters"
            title="The point is not more tools. It is more coherence."
            description="MigraTeck is meant to reduce fragmentation by bringing product experiences, technical systems, communication channels, and business workflows into one clearer operating model."
            align="center"
          />

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {useCases.map((item, index) => (
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
              Build on a platform that stays organized.
            </h2>
            <p className="mx-auto mt-5 max-w-[700px] text-base leading-8 text-white/68 md:text-lg">
              Explore the ecosystem, understand the platform, and see how MigraTeck brings products, infrastructure, and operations together as one company system.
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
