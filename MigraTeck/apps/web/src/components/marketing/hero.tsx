import { products } from "@/data/products";

export default function MigraTeckHero() {
  const ecosystem = [
    { name: "MigraHosting",  label: "Infrastructure",  accent: "from-indigo-400/80 via-violet-400/70 to-blue-400/70",   logo: "/brands/products/migrahosting.png"  },
    { name: "MigraPanel",   label: "Control plane",   accent: "from-blue-400/80 via-sky-400/70 to-cyan-400/70",        logo: "/brands/products/migrapanel.png"    },
    { name: "MigraVoice",   label: "Communications",  accent: "from-fuchsia-400/80 via-pink-400/70 to-violet-400/70",  logo: "/brands/products/migravoice.png"    },
    { name: "MigraMail",    label: "Messaging",       accent: "from-cyan-400/80 via-sky-400/70 to-blue-400/70",        logo: "/brands/products/migramail.png"     },
    { name: "MigraIntake",  label: "Onboarding",      accent: "from-lime-300/80 via-emerald-400/70 to-cyan-400/70",    logo: "/brands/products/migraintake.png"   },
    { name: "MigraDrive",   label: "Storage",         accent: "from-emerald-400/80 via-teal-400/70 to-blue-400/70",    logo: "/brands/products/migradrive.png"    },
    { name: "MigraPilot",     label: "Automation",      accent: "from-amber-300/80 via-orange-400/70 to-yellow-400/70",    logo: "/brands/products/migrapilot.png"      },
    { name: "MigraInvoice",   label: "Billing",         accent: "from-violet-400/80 via-purple-400/70 to-fuchsia-400/70",  logo: "/brands/products/migrainvoice.png"    },
    { name: "MigraMarketing", label: "Growth",          accent: "from-rose-400/80 via-pink-400/70 to-fuchsia-400/70",      logo: "/brands/products/migramarketing.png" },
  ];

  const proofItems = ["MigraHosting", "MigraPanel", "MigraPilot", "MigraMail", "MigraDrive"];

  return (
    <section className="relative overflow-hidden bg-[#0B1220] text-white">
      <style>{`
        @keyframes migrateckFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes migrateckPulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
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

      <div className="relative mx-auto flex min-h-screen max-w-[1280px] flex-col px-6 pb-14 pt-0 md:px-8 lg:px-10">


        {/* ── Main content ─────────────────────────────────────── */}
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
              <a href="/products" className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400">
                Start building
              </a>
              <a href="/platform" className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/82 transition hover:bg-white/8">
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

          {/* ── Right panel — ecosystem composition ────────────── */}
          <div className="lg:col-span-6 lg:pl-6">
            <div className="relative mx-auto max-w-[560px]" style={{ animation: "migrateckFloat 6.5s ease-in-out infinite" }}>
              <div className="absolute -inset-10 bg-blue-500/10 blur-3xl" />

              <div className="relative z-10 rounded-[32px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-2xl md:p-6">
                <div className="absolute inset-0 rounded-[32px] bg-[linear-gradient(135deg,rgba(255,255,255,0.10),rgba(255,255,255,0.02)_30%,rgba(59,130,246,0.08)_100%)] pointer-events-none" />

                <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#0F172A]/80 p-5 md:p-6">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.10),transparent_30%)]" />
                  <div
                    className="absolute left-1/2 top-[48%] h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.22),rgba(59,130,246,0.12),transparent_68%)] blur-2xl"
                    style={{ animation: "migrateckPulse 5.5s ease-in-out infinite" }}
                  />

                  {/* panel header */}
                  <div className="relative flex items-start justify-between gap-4 border-b border-white/8 pb-5">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.30em] text-white/35">Connected product system</p>
                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">MigraTeck Ecosystem</h2>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" style={{ animation: "migrateckPulse 2.5s ease-in-out infinite" }} />
                      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-200/90">{products.length} products</span>
                    </div>
                  </div>

                  {/* anchor card — MigraTeck */}
                  <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] px-5 py-4">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="relative h-11 w-11 overflow-hidden rounded-2xl border border-white/15 bg-white/10 p-1.5 shadow-lg">
                          <img src="/brands/products/migrateck-official.png" alt="MigraTeck" className="h-full w-full object-contain" />
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">Platform</p>
                          <p className="mt-0.5 text-base font-semibold tracking-[-0.02em] text-white">MigraTeck</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-white/35">Unified</p>
                        <p className="mt-0.5 text-xs text-white/60">One identity layer</p>
                      </div>
                    </div>
                    <div className="mt-3.5 h-px w-full bg-gradient-to-r from-blue-400/60 via-indigo-400/50 via-violet-400/40 to-fuchsia-400/30" />
                  </div>

                  {/* product grid */}
                  <div className="relative mt-3 grid grid-cols-2 gap-2.5 md:gap-3">
                    {ecosystem.map((product) => (
                      <a
                        key={product.name}
                        href={`/products/${product.name.toLowerCase()}`}
                        className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3.5 transition duration-300 hover:z-20 hover:border-white/20 hover:bg-white/[0.08] last:col-span-2"
                      >
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-60" />
                        <div className="absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100">
                          <div className={`absolute inset-0 bg-gradient-to-br ${product.accent} opacity-[0.07]`} />
                        </div>
                        <div className="relative flex items-center gap-2.5">
                          <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-white/12 bg-white/8">
                            <img src={product.logo} alt={product.name} className="h-full w-full object-contain p-0.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium leading-tight text-white/88">{product.name}</p>
                            <p className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-white/35">{product.label}</p>
                          </div>
                        </div>
                        <div className={`mt-3 h-1 rounded-full bg-gradient-to-r ${product.accent} opacity-80`} />
                      </a>
                    ))}
                  </div>

                  {/* footer */}
                  <div className="relative mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm leading-snug text-white/60">
                        One company. Connected products.
                      </p>
                      <div className="shrink-0 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-blue-200/80">
                        Live
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
