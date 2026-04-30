import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { serviceInquiries } from "@/lib/inquiry";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Services",
  description:
    "MigraTeck services include a fast website launch offer and recurring AI-assisted content operations for businesses that need practical execution.",
  path: "/services",
});

const services = [
  {
    id: "website-launch-48h",
    title: "48-Hour Website Launch",
    desc: "A premium small-business website offer built to go live fast without looking rushed or generic.",
    audience: "Businesses that need a credible web presence quickly and want one offer that already covers launch essentials.",
    outcome: "A live website, connected domain, business email, and SEO-ready launch posture in one managed package.",
    inquiryHref: serviceInquiries.websiteLaunch,
  },
  {
    id: "ai-content-generator",
    title: "AI Content Generator",
    desc: "Recurring content operations for blogs, product copy, landing pages, emails, and campaigns.",
    audience: "Teams that need publishing velocity and want MigraTeck to turn business inputs into usable marketing assets.",
    outcome: "A managed content system that keeps campaigns, landing pages, and product messaging moving without starting from zero each time.",
    inquiryHref: serviceInquiries.aiContentGenerator,
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
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Services", url: absoluteUrl("/services") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-0 bottom-0 h-[400px] w-[400px] rounded-full bg-pink-500/10 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Services
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Launch services built for speed, clarity, and real delivery.
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              MigraTeck offers two practical commercial service tracks: a fast website
              launch service for businesses that need a credible digital presence now,
              and a recurring content system for teams that need ongoing publishing support.
            </p>
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap gap-4">
              <Link href="#service-cards" className={ui.btnPrimaryLight}>View service packages</Link>
              <Link href="/pricing" className={ui.btnSecondaryDark}>View pricing</Link>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <div id="service-cards" className="grid gap-6 xl:grid-cols-2">
            {services.map((s) => (
              <div key={s.title} id={s.id} className={cn(ui.card, "flex flex-col p-6 sm:p-8")}>
                <p className={ui.eyebrowBrand}>Service track</p>
                <h3 className={cn(ui.h3, "mt-3")}>{s.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{s.desc}</p>
                <div className="mt-auto pt-6 space-y-4 border-t border-white/10">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Who it is for</p>
                    <p className="mt-1 text-sm text-slate-400">{s.audience}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Intended outcome</p>
                    <p className="mt-1 text-sm text-slate-400">{s.outcome}</p>
                  </div>
                  <div className="pt-2">
                    <a href={s.inquiryHref} className={cn(ui.btnPrimaryLight, "inline-flex")}>
                      Start with this track
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn("border-t border-white/10", ui.sectionPy)}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={cn(ui.card, "p-8")}>
              <p className={ui.eyebrowBrand}>Why these services</p>
              <h2 className={cn(ui.h2, "mt-3")}>Practical entry points for real launch outcomes.</h2>
              <p className={cn(ui.bodySmall, "mt-4")}>
                These service tracks are designed for businesses that need execution, not
                just advice. Whether the goal is getting a credible site live this week or
                keeping content moving every month, both tracks deliver a defined outcome
                inside a managed process.
              </p>
            </div>

            <div className={cn(ui.card, "p-8")}>
              <p className={ui.eyebrowBrand}>System build path</p>
              <h2 className={cn(ui.h2, "mt-3")}>Recommended delivery phases</h2>
              <div className="mt-6 space-y-4">
                {deliveryPhases.map((phase) => (
                  <div key={phase.title} className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5">
                    <h3 className="text-lg font-semibold text-white">{phase.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{phase.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Start your engagement.</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            Tell us which track fits your situation and we will scope it out. No commitment required to start the conversation.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={serviceInquiries.general}
              className={ui.btnPrimaryLight}
            >
              Send inquiry
            </a>
            <Link href="/pricing" className={ui.btnSecondaryDark}>View pricing</Link>
          </div>
          <p className="mt-6 text-sm text-slate-400">Or reach us directly at <a href="mailto:services@migrateck.com" className="text-blue-400 hover:text-blue-300">services@migrateck.com</a></p>
        </div>
      </section>
    </>
  );
}
