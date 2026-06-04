import { redirect } from "next/navigation";
import Image from "next/image";
import type { ReactNode } from "react";
import { ShieldCheck, ExternalLink, Gavel, ArrowUpRight, Scale, Inbox, Lock, Mail } from "lucide-react";

import { getSession } from "../lib/auth";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { ANNOUPALE_LINKS, probeAnnoupaleWeb, type WebProbe } from "../lib/annoupale";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ helpers */

type Tone = "live" | "configured" | "pending" | "recommended" | "off" | "enforced";

const TONE: Record<Tone, { dot: string; badge: string; text: string }> = {
  live: {
    dot: "bg-emerald-400",
    badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
    text: "Live",
  },
  enforced: {
    dot: "bg-emerald-400",
    badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
    text: "Enforced",
  },
  configured: {
    dot: "bg-sky-400",
    badge: "border-sky-400/20 bg-sky-500/10 text-sky-300",
    text: "Configured",
  },
  pending: {
    dot: "bg-amber-400",
    badge: "border-amber-400/20 bg-amber-500/10 text-amber-300",
    text: "Pending",
  },
  recommended: {
    dot: "bg-amber-400",
    badge: "border-amber-400/20 bg-amber-500/10 text-amber-300",
    text: "Recommended",
  },
  off: {
    dot: "bg-slate-500",
    badge: "border-slate-400/20 bg-slate-500/10 text-slate-400",
    text: "Not connected yet",
  },
};

const StatusBadge = ({ tone, label }: { tone: Tone; label?: string | undefined }) => {
  const t = TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium ${t.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {label ?? t.text}
    </span>
  );
};

const probeTone = (p: WebProbe): Tone =>
  p.status === "operational" ? "live" : p.status === "degraded" ? "recommended" : "off";

/** External deep link card (opens in a new tab, no token, no iframe). */
const ActionCard = ({
  icon,
  title,
  description,
  href,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-fuchsia-400/40 hover:bg-white/[0.04]"
  >
    <div className="flex items-start justify-between gap-2">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500/20 to-pink-500/20 text-fuchsia-200">
        {icon}
      </span>
      <ArrowUpRight className="h-4 w-4 text-slate-500 transition group-hover:text-fuchsia-300" />
    </div>
    <p className="mt-3 text-sm font-semibold text-white">{title}</p>
    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{description}</p>
  </a>
);

/** A labelled status row inside an operations card. */
const OpsRow = ({
  label,
  tone,
  badgeLabel,
}: {
  label: string;
  tone: Tone;
  badgeLabel?: string | undefined;
}) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <span className="text-[12px] text-slate-300">{label}</span>
    <StatusBadge tone={tone} label={badgeLabel} />
  </div>
);

const DeepLink = ({ label, path, href }: { label: string; path: string; href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="group flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 transition hover:border-fuchsia-400/40 hover:bg-white/[0.05]"
  >
    <span className="min-w-0">
      <span className="block truncate text-[12px] font-medium text-slate-200">{label}</span>
      <span className="block truncate font-mono text-[10px] text-slate-500">{path}</span>
    </span>
    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500 transition group-hover:text-fuchsia-300" />
  </a>
);

/* --------------------------------------------------------------------- page */

export default async function AnnoupalePage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const web = await probeAnnoupaleWeb();
  const headerTone = probeTone(web);

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/annoupale"
      title="AnnouPale Trust & Operations"
      subtitle="Operational control surface for AnnouPale and Pale compliance, safety, moderation, and platform health."
      actions={
        <>
          <StatusBadge tone={headerTone} label={headerTone === "live" ? "Operational" : web.label} />
          <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            Production
          </span>
        </>
      }
    >
      {/* Branded hero */}
      <SectionCard className="border-fuchsia-400/15 bg-gradient-to-br from-fuchsia-500/[0.06] via-purple-500/[0.04] to-pink-500/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              <Image
                src="/brands/products/annoupale.png"
                alt="AnnouPale logo"
                fill
                sizes="56px"
                className="object-contain p-1.5"
              />
            </span>
            <div>
              <p className="text-lg font-semibold text-white">AnnouPale</p>
              <p className="text-[12px] text-slate-400">Social &amp; Community Platform</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Web reachability</p>
            <p className="text-sm font-semibold text-white">
              {web.label}
              {web.latencyMs != null && web.status !== "unreachable" && (
                <span className="ml-1 font-mono text-[11px] font-normal text-slate-400">
                  {web.latencyMs} ms
                </span>
              )}
            </p>
            <p className="text-[10px] text-slate-500">Live HEAD probe · annoupale.com</p>
          </div>
        </div>
      </SectionCard>

      {/* Hero / action cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ActionCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Open AnnouPale Admin"
          description="Full trust & safety admin console."
          href={ANNOUPALE_LINKS.admin}
        />
        <ActionCard
          icon={<Gavel className="h-5 w-5" />}
          title="Compliance Case Queue"
          description="Privacy, safety, security & IP cases."
          href={ANNOUPALE_LINKS.complianceCases}
        />
        <ActionCard
          icon={<Scale className="h-5 w-5" />}
          title="Legal Center"
          description="Public policies, terms & data rights."
          href={ANNOUPALE_LINKS.legal}
        />
        <ActionCard
          icon={<Inbox className="h-5 w-5" />}
          title="Public Intake Forms"
          description="Where users file requests & reports."
          href={ANNOUPALE_LINKS.legalContact}
        />
      </div>

      {/* Operations cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <SectionCard title="Compliance">
          <div className="-mt-1 divide-y divide-white/5">
            <OpsRow label="Privacy requests" tone="live" />
            <OpsRow label="Safety reports" tone="live" />
            <OpsRow label="Security reports" tone="live" />
            <OpsRow label="IP / copyright" tone="live" />
            <OpsRow label="Appeals" tone="live" />
          </div>
          <a
            href={ANNOUPALE_LINKS.complianceCases}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 py-1.5 text-[11px] font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20"
          >
            Open case queue <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </SectionCard>

        <SectionCard title="Safety &amp; Moderation">
          <div className="-mt-1 divide-y divide-white/5">
            <OpsRow label="Moderation queue" tone="off" />
            <OpsRow label="Appeals review" tone="live" />
            <OpsRow label="Account status actions" tone="enforced" badgeLabel="In AnnouPale" />
          </div>
          <a
            href={ANNOUPALE_LINKS.adminAppeals}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/10"
          >
            Open appeals <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Live moderation metrics are not connected to the panel yet.
          </p>
        </SectionCard>

        <SectionCard title="Platform Health">
          <div className="-mt-1 divide-y divide-white/5">
            <OpsRow
              label="Web app (annoupale.com)"
              tone={probeTone(web)}
              badgeLabel={web.label}
            />
            <OpsRow label="Admin API health" tone="off" />
            <OpsRow label="Live / streaming" tone="off" />
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
            Web status is a live HEAD probe. Deeper health signals require an AnnouPale health
            endpoint (deferred).
          </p>
        </SectionCard>

        <SectionCard title="Legal Readiness">
          <div className="-mt-1 divide-y divide-white/5">
            <OpsRow label="Legal Center live" tone="live" />
            <OpsRow label="SOPs complete" tone="configured" badgeLabel="Documented" />
            <OpsRow label="Compliance inboxes" tone="configured" badgeLabel="Deliverable" />
            <OpsRow label="Counsel review" tone="pending" />
          </div>
          <a
            href={ANNOUPALE_LINKS.legal}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/10"
          >
            Open Legal Center <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </SectionCard>
      </div>

      {/* Compliance status */}
      <SectionCard
        title="Compliance Status"
        subtitle="Qualitative operational status — no live counts are pulled from AnnouPale yet."
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          <OpsRow label="Public intake forms" tone="live" />
          <OpsRow label="Admin queue" tone="live" />
          <OpsRow label="SMTP notifications" tone="live" />
          <OpsRow label="Staff-only gating" tone="enforced" badgeLabel="Enforced by AnnouPale" />
          <OpsRow label="Counsel review" tone="pending" />
          <OpsRow label="Mail TLS monitoring" tone="recommended" />
        </div>
      </SectionCard>

      {/* Deep links */}
      <SectionCard
        title="Deep Links"
        subtitle="Canonical AnnouPale surfaces (apex domain, opens in a new tab). AnnouPale enforces its own staff roles."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <DeepLink label="Admin Console" path="/admin" href={ANNOUPALE_LINKS.admin} />
          <DeepLink
            label="Compliance Cases"
            path="/admin/compliance/cases"
            href={ANNOUPALE_LINKS.complianceCases}
          />
          <DeepLink label="Privacy Request" path="/privacy/request" href={ANNOUPALE_LINKS.privacyRequest} />
          <DeepLink label="Safety Report" path="/safety/report" href={ANNOUPALE_LINKS.safetyReport} />
          <DeepLink label="Security Report" path="/security/report" href={ANNOUPALE_LINKS.securityReport} />
          <DeepLink label="IP / Copyright Report" path="/ip/report" href={ANNOUPALE_LINKS.ipReport} />
          <DeepLink label="Appeals" path="/appeals" href={ANNOUPALE_LINKS.appeals} />
          <DeepLink
            label="Account Deletion Help"
            path="/help/account-deletion"
            href={ANNOUPALE_LINKS.accountDeletion}
          />
        </div>
      </SectionCard>

      {/* Security note */}
      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          This module is a deep-link surface. It does not embed the AnnouPale admin, passes no
          tokens in URLs, and grants no AnnouPale permissions. Every linked surface still requires
          the appropriate AnnouPale staff role (<span className="text-slate-300">platform_admin</span>{" "}
          / <span className="text-slate-300">trust_safety_admin</span>) to access.
        </p>
      </div>

      <p className="pt-1 text-center text-[10px] text-slate-600">
        <Mail className="mr-1 inline h-3 w-3 align-[-1px]" />
        Compliance SOPs &amp; inbox routing maintained inside AnnouPale · MigraPanel Control Center
      </p>
    </ConsolePageShell>
  );
}
