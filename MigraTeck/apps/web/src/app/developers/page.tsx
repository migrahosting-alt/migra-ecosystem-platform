import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Developers",
  description:
    "Technical access for MigraHosting integrations, customer workflows, APIs, and secure platform operations.",
  path: "/developers",
});

const developerAreas = [
  {
    title: "API access",
    desc: "Use stable endpoints for account workflows, service operations, and related platform tasks.",
  },
  {
    title: "Portal integrations",
    desc: "Connect customer-facing actions such as provisioning, updates, and support flows to your own systems.",
  },
  {
    title: "Security controls",
    desc: "Authentication, scoped access, and account context are built into the platform path from the start.",
  },
  {
    title: "Operational support",
    desc: "Developer work stays connected to the same hosting and support model customers already use.",
  },
] as const;

const systemTracks = [
  {
    title: "Shared account context",
    desc: "Requests can align with the same account and organization model used by the client portal.",
  },
  {
    title: "Structured service actions",
    desc: "Provisioning, service access, and support-oriented workflows are grouped by responsibility.",
  },
  {
    title: "Verified operational paths",
    desc: "API work, downloads, and service operations follow the same trust boundary as the public site.",
  },
] as const;

const starterPaths = [
  {
    title: "Browse products",
    desc: "See the hosting, email, website, and platform services that can connect to your workflow.",
    href: "/products",
    label: "View products",
  },
  {
    title: "Review security",
    desc: "Understand the public security model, disclosure path, and platform protections before integrating.",
    href: "/security",
    label: "View security",
  },
  {
    title: "Request access",
    desc: "Use the access request flow if you need a customer or developer account for operational work.",
    href: "/request-access",
    label: "Request access",
  },
] as const;

export default function DevelopersPage() {
  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute right-[-5rem] top-28 h-80 w-80 rounded-full bg-violet-300/30 blur-[95px]" />
        <div className="pointer-events-none absolute left-[-4rem] bottom-0 h-72 w-72 rounded-full bg-orange-200/35 blur-[90px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="max-w-3xl">
            <p className={ui.eyebrowBrand}>Developers</p>
            <h1 className={cn(ui.h1, "mt-5 max-w-2xl")}>
              Technical access for integrations, provisioning flows, and secure service operations.
            </h1>
            <p className={cn(ui.body, "mt-6 max-w-2xl")}>
              This page is for teams that need API access, customer workflow integration, or
              operational support around MigraHosting services. The public site stays simple,
              but the underlying platform still gives technical teams a clean way to work.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/request-access" className={ui.btnPrimary}>
                Request access
              </Link>
              <Link href="/security" className={ui.btnSecondary}>
                Review security
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Developer surface</p>
          <h2 className={cn(ui.h2, "mt-3")}>Built for technical teams without turning the whole site into a platform pitch.</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {developerAreas.map((area, index) => (
              <div key={area.title} className={cn(ui.card, ui.cardHover, "p-6 sm:p-7")}>
                <span className={ui.depthNum}>{index + 1}</span>
                <h3 className={cn(ui.h3, "mt-4")}>{area.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{area.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className={cn(ui.cardStrong, "p-8 sm:p-10")}>
              <p className={ui.eyebrowBrand}>How integration work is framed</p>
              <h2 className={cn(ui.h2, "mt-3 max-w-lg")}>Technical structure around real customer workflows.</h2>
              <div className="mt-8 grid gap-4">
                {systemTracks.map((track) => (
                  <div key={track.title} className={cn(ui.cardMuted, "p-5")}>
                    <p className="text-sm font-semibold text-[var(--brand-ink)]">{track.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{track.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-[30px] border border-[var(--line)] bg-[rgba(255,255,255,0.9)] shadow-[0_28px_70px_rgba(109,40,217,0.12)]">
              <div className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-4">
                <div className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                <span className="ml-3 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Example request
                </span>
              </div>
              <pre className="overflow-x-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(250,245,255,0.9))] p-5 text-[13px] leading-7 text-slate-700">
                <code>
                  POST <span className="text-fuchsia-600">/v1/products/access</span>
                  {"\n"}
                  Authorization: <span className="text-violet-700">Bearer mt_live_sk_...</span>
                  {"\n"}
                  Content-Type: <span className="text-violet-700">application/json</span>
                  {"\n\n"}
                  {"{"}
                  {"\n"}
                  {'  "product": "migrahosting",'}
                  {"\n"}
                  {'  "action": "provision",'}
                  {"\n"}
                  {'  "org_id": "org_01H..."'}
                  {"\n"}
                  {"}"}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Start building</p>
          <h2 className={cn(ui.h2, "mt-3")}>Three useful starting points.</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {starterPaths.map((path) => (
              <div key={path.title} className={cn(ui.card, "flex flex-col p-6")}>
                <h3 className={cn(ui.h3, "text-[1.35rem]")}>{path.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{path.desc}</p>
                <Link href={path.href} className="mt-5 text-sm font-semibold text-fuchsia-700 transition hover:text-fuchsia-800">
                  {path.label} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
