import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Services",
  description:
    "Commercial service packages for fast website launch and recurring AI content production, presented inside the broader MigraTeck platform story.",
  path: "/services",
});

const services = [
  {
    id: "website-launch-48h",
    title: "48-Hour Website Launch",
    desc: "A premium small-business website offer built to go live fast without looking rushed or generic.",
    audience: "Businesses that need a credible web presence quickly and want one offer that already covers launch essentials.",
    outcome: "A live website, connected domain, business email, and SEO-ready launch posture in one managed package.",
  },
  {
    id: "ai-content-generator",
    title: "AI Content Generator",
    desc: "Recurring content operations for blogs, product copy, landing pages, emails, and campaigns.",
    audience: "Teams that need publishing velocity and want MigraTeck to turn business inputs into usable marketing assets.",
    outcome: "A managed content system that keeps campaigns, landing pages, and product messaging moving without starting from zero each time.",
  },
] as const;

const deliveryPhases = [
  {
    title: "Phase 1: Intake and brand setup",
    description: "Collect business context, offer details, tone, ICP, target keywords, preferred layouts, and publishing goals.",
  },
  {
    title: "Phase 2: Guided generation engine",
    description: "Turn structured prompts and reusable templates into launch pages, content drafts, and reusable marketing assets.",
  },
  {
    title: "Phase 3: Human review and fulfillment",
    description: "Route outputs through MigraTeck review, approval, edits, and publish-ready packaging before client delivery.",
  },
  {
    title: "Phase 4: Client dashboard integration",
    description: "Expose requests, approvals, revisions, and delivery history inside the broader platform over time.",
  },
] as const;

export default function ServicesPage() {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 bottom-0 h-[400px] w-[400px] rounded-full bg-pink-500/10 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Services
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Commercial offers with a stronger pitch and cleaner frame.
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              MigraTeck now leads with a fast launch offer for businesses that need a real site quickly, while keeping recurring AI content operations visible as a second growth service.
            </p>
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-4">
              <Link href="#service-cards" className={ui.btnPrimaryLight}>View service packages</Link>
              <Link href="/pricing" className={ui.btnSecondaryDark}>View pricing</Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div id="service-cards" className="grid gap-6 xl:grid-cols-2">
            {services.map((s) => (
              <div key={s.title} id={s.id} className={cn(ui.card, "flex flex-col p-6 sm:p-8")}>
                <p className={ui.eyebrowBrand}>Service track</p>
                <h3 className={cn(ui.h3, "mt-3")}>{s.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{s.desc}</p>
                <div className="mt-auto pt-6 space-y-4 border-t border-slate-100">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Who it is for</p>
                    <p className="mt-1 text-sm text-slate-600">{s.audience}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Intended outcome</p>
                    <p className="mt-1 text-sm text-slate-600">{s.outcome}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn("border-t border-slate-100 bg-slate-50/50", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={cn(ui.card, "p-8")}>
              <p className={ui.eyebrowBrand}>Why this matters</p>
              <h2 className={cn(ui.h2, "mt-3")}>The public site now supports a real launch offer.</h2>
              <p className={cn(ui.bodySmall, "mt-4")}>
                When someone arrives from a campaign or sales conversation, the service page should confirm the same promise they already saw elsewhere. That means faster trust and less confusion between platform products and commercial services.
              </p>
            </div>

            <div className={cn(ui.card, "p-8")}>
              <p className={ui.eyebrowBrand}>System build path</p>
              <h2 className={cn(ui.h2, "mt-3")}>Recommended delivery phases</h2>
              <div className="mt-6 space-y-4">
                {deliveryPhases.map((phase) => (
                  <div key={phase.title} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
                    <h3 className="text-lg font-semibold text-slate-950">{phase.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{phase.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
