"use client";

import Image from "next/image";

const modules = [
  {
    label: "Hosting",
    code: "MH",
    accent: "from-indigo-400/75 via-violet-400/70 to-blue-400/70",
    logo: "/logos/MigraHosting_official_logo.png",
  },
  {
    label: "Panel",
    code: "MP",
    accent: "from-blue-400/75 via-sky-400/70 to-cyan-400/70",
    logo: "/logos/MigraPanel_official_Logo.png",
  },
  {
    label: "Voice",
    code: "MV",
    accent: "from-fuchsia-400/75 via-pink-400/70 to-violet-400/70",
    logo: "/logos/MigraVoice_Official_logo.png",
  },
  {
    label: "Mail",
    code: "MM",
    accent: "from-cyan-400/75 via-sky-400/70 to-blue-400/70",
    logo: "/logos/MigraMail_official_logo.png",
  },
  {
    label: "Intake",
    code: "MI",
    accent: "from-lime-300/75 via-emerald-400/70 to-cyan-400/70",
    logo: "/logos/MigraIntake_official_logo.png",
  },
  {
    label: "Marketing",
    code: "MK",
    accent: "from-orange-400/75 via-amber-400/70 to-yellow-400/70",
    logo: "/logos/MigraMarketing_official_logo.png",
  },
  {
    label: "Drive",
    code: "MD",
    accent: "from-emerald-400/75 via-teal-400/70 to-blue-400/70",
    logo: "/logos/MigraDrive_official_logo.png",
  },
  {
    label: "Pilot",
    code: "MP",
    accent: "from-violet-400/75 via-purple-400/70 to-indigo-400/70",
    logo: "/logos/MigraPilot_official_logo.png",
  },
  {
    label: "Invoice",
    code: "MIV",
    accent: "from-rose-400/75 via-pink-400/70 to-fuchsia-400/70",
    logo: "/logos/MigraInvoice_official_logo.png",
  },
];

const navItems = ["Platform", "Products", "Pricing", "Developers", "Downloads"];
const proofItems = ["Products", "Identity", "Hosting", "Billing", "Delivery"];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-[#0B1220] text-white">
      <style>{`
        @keyframes migrateckFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes migrateckPulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.06); }
        }
        @keyframes migrateckDrift {
          0%, 100% { transform: translate3d(0,0,0); }
          50% { transform: translate3d(10px,-8px,0); }
        }
      `}</style>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(59,130,246,0.26),transparent_35%),radial-gradient(circle_at_78%_28%,rgba(96,165,250,0.12),transparent_26%),linear-gradient(135deg,rgba(28,47,107,0.34),rgba(11,18,32,0.95)_58%,rgba(11,18,32,1))]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_18%,transparent_82%,rgba(255,255,255,0.02))]" />
      <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-[1280px] flex-col px-6 pb-14 pt-6 md:px-8 lg:px-10">
        <header className="rounded-full border border-white/10 bg-white/5 px-4 backdrop-blur-xl md:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-blue-500 shadow-lg shadow-fuchsia-500/20">
                <Image
                  src="/logos/MigraTeck_Official_logo.png"
                  alt="MigraTeck"
                  width={32}
                  height={32}
                  className="object-contain"
                />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-[0.18em] text-white/95">MIGRATECK</div>
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Unified ecosystem</div>
              </div>
            </div>

            <nav className="hidden items-center gap-7 lg:flex">
              {navItems.map((item) => (
                <a key={item} href="#" className="text-sm text-white/68 transition hover:text-white">
                  {item}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2 md:gap-3">
              <a
                href="#"
                className="hidden rounded-full px-4 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white sm:inline-flex"
              >
                Log in
              </a>
              <a
                href="#"
                className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 md:px-5"
              >
                Start
                <span className="ml-2">→</span>
              </a>
            </div>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-14 py-12 lg:grid-cols-12 lg:gap-8 lg:py-20">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.28em] text-blue-200/90">
              Unified software platform
            </div>

            <h1 className="mt-6 max-w-[760px] text-5xl font-semibold leading-[0.98] tracking-[-0.045em] text-white md:text-6xl lg:text-7xl">
              Run your products, access, and delivery — from one platform.
            </h1>

            <p className="mt-6 max-w-[560px] text-base leading-8 text-white/68 md:text-lg">
              MigraTeck connects identity, billing, hosting, and software distribution into one coordinated system built for serious software businesses.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="#"
                className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400"
              >
                Start building
              </a>
              <a
                href="#"
                className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/82 transition hover:bg-white/8"
              >
                See platform
              </a>
            </div>

            <div className="mt-10 h-px w-full max-w-[560px] bg-gradient-to-r from-white/20 via-white/8 to-transparent" />

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm text-white/42 md:gap-x-6">
              {proofItems.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-300/70" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 lg:pl-6">
            <div
              className="relative mx-auto max-w-[560px]"
              style={{ animation: "migrateckFloat 6.5s ease-in-out infinite" }}
            >
              <div className="absolute -inset-10 bg-blue-500/10 blur-3xl" />
              <div className="absolute inset-y-0 right-[-10%] z-0 flex items-center justify-center opacity-[0.14] blur-[1px]">
                <Image
                  src="/logos/MigraTeck_Official_logo.png"
                  alt="MigraTeck logo watermark"
                  width={420}
                  height={420}
                  className="object-contain"
                  style={{ animation: "migrateckDrift 12s ease-in-out infinite" }}
                />
              </div>

              <div className="relative z-10 rounded-[32px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-2xl md:p-6">
                <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-[linear-gradient(135deg,rgba(255,255,255,0.10),rgba(255,255,255,0.02)_30%,rgba(59,130,246,0.08)_100%)]" />

                <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#0F172A]/80 p-5 md:p-6">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.10),transparent_30%)]" />
                  <div
                    className="absolute left-1/2 top-[48%] h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.28),rgba(59,130,246,0.16),transparent_68%)] blur-2xl"
                    style={{ animation: "migrateckPulse 5.5s ease-in-out infinite" }}
                  />

                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <path d="M30 32 C40 38, 46 40, 50 50" stroke="rgba(139,92,246,0.45)" strokeWidth="0.4" fill="none" />
                    <path d="M70 32 C60 38, 54 40, 50 50" stroke="rgba(56,189,248,0.45)" strokeWidth="0.4" fill="none" />
                    <path d="M30 50 C40 50, 44 50, 50 50" stroke="rgba(96,165,250,0.35)" strokeWidth="0.35" fill="none" />
                    <path d="M70 50 C60 50, 56 50, 50 50" stroke="rgba(45,212,191,0.35)" strokeWidth="0.35" fill="none" />
                    <path d="M30 68 C40 62, 46 58, 50 50" stroke="rgba(168,85,247,0.42)" strokeWidth="0.4" fill="none" />
                    <path d="M70 68 C60 62, 54 58, 50 50" stroke="rgba(34,211,238,0.42)" strokeWidth="0.4" fill="none" />
                  </svg>

                  <div className="relative flex items-start justify-between gap-4 border-b border-white/8 pb-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-white/38">Platform overview</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">MigraTeck Platform</h2>
                    </div>
                    <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-200/90">
                      Unified
                    </div>
                  </div>

                  <div className="relative mt-6 grid grid-cols-3 gap-2.5 md:gap-3">
                    {modules.map((module) => (
                      <div
                        key={module.label}
                        className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3.5 transition duration-300 hover:z-20 hover:scale-[1.03] hover:border-white/20 hover:bg-white/[0.08]"
                      >
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-60" />
                        <div className="absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100">
                          <div className={`absolute inset-0 bg-gradient-to-br ${module.accent} opacity-[0.08]`} />
                        </div>

                        <div className="relative flex flex-col items-center gap-2 text-center">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07] p-1.5">
                            <Image
                              src={module.logo}
                              alt={module.label}
                              width={28}
                              height={28}
                              className="h-full w-full object-contain"
                            />
                          </div>
                          <p className="text-[11px] font-medium leading-tight text-white/72">{module.label}</p>
                        </div>

                        <div className={`mt-3 h-1 rounded-full bg-gradient-to-r ${module.accent} opacity-75`} />
                      </div>
                    ))}
                  </div>

                  <div className="relative mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-white/36">Coordination layer</p>
                        <p className="mt-2 text-sm text-white/74">
                          Identity, billing, hosting, delivery, communication, and intake work as one connected operating layer.
                        </p>
                      </div>
                      <div className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-blue-200/85">
                        System ready
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-12 md:pb-20 md:pt-16">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-[#0b1728]/16 via-[#0b1728]/6 to-transparent" />
        <div className="absolute -left-24 -top-20 h-96 w-96 rounded-full bg-[color:var(--brand-100)] blur-3xl" />
        <div className="absolute right-0 top-10 h-80 w-80 rounded-full bg-[color:var(--accent-100)] blur-3xl" />
      </div>
      <div className="relative mx-auto w-full max-w-7xl rounded-[2rem] border border-[var(--line)] bg-white/82 p-8 shadow-[0_30px_80px_rgba(10,22,40,0.08)] backdrop-blur md:p-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(26,168,188,0.72),transparent)]" />

        <div className="grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-center">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-6"
        >
          <Chip>Enterprise Control Plane</Chip>
          <h1 className="max-w-[11ch] text-balance font-[var(--font-space-grotesk)] text-4xl font-black tracking-[-0.06em] text-[var(--ink)] md:text-7xl">
            The enterprise surface for products, access, and launch control.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-[var(--ink-muted)]">
            MigraTeck brings centralized identity, multi-tenant governance, entitlement intelligence, pricing, and deterministic provisioning into one sharper front door.
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/products">Browse Products</LinkButton>
            <LinkButton href="/platform" variant="secondary">
              Explore Architecture
            </LinkButton>
          </div>
          <Link
            href="/developers"
            className="inline-flex text-sm font-semibold text-[var(--brand-700)] transition-colors hover:text-[var(--brand-600)]"
          >
            View developer surface →
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[1.75rem] border border-slate-700 bg-[radial-gradient(circle_at_top_left,rgba(26,168,188,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,197,83,0.12),transparent_24%),linear-gradient(180deg,#09111d,#122033)] p-6 text-white shadow-[0_20px_60px_-38px_rgba(13,27,42,0.45)]"
        >
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Platform Depth</p>
          <div className="space-y-4">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.16 + index * 0.08 }}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{stat.label}</p>
                <p className="mt-1 text-base font-semibold text-white">{stat.value}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
        </div>
      </div>
    </section>
  );
}
