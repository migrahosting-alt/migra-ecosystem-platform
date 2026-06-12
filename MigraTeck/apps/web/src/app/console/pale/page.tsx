import { redirect } from "next/navigation";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  Smartphone,
  ShieldCheck,
  Fingerprint,
  MessageSquare,
  Globe,
  ExternalLink,
  ArrowUpRight,
  Lock,
  Server,
} from "lucide-react";

import { getSession } from "../lib/auth";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import {
  getPaleBackendHealth,
  formatUptime,
  PALE_PLAY_URL,
} from "../lib/pale";
import { ANNOUPALE_LINKS } from "../lib/annoupale";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ helpers */

type Tone = "live" | "enforced" | "configured" | "pending" | "off";

const TONE: Record<Tone, { dot: string; badge: string; text: string }> = {
  live: { dot: "bg-emerald-400", badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300", text: "Live" },
  enforced: { dot: "bg-emerald-400", badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300", text: "Enforced" },
  configured: { dot: "bg-sky-400", badge: "border-sky-400/20 bg-sky-500/10 text-sky-300", text: "Configured" },
  pending: { dot: "bg-amber-400", badge: "border-amber-400/20 bg-amber-500/10 text-amber-300", text: "Pending" },
  off: { dot: "bg-slate-500", badge: "border-slate-400/20 bg-slate-500/10 text-slate-400", text: "Not connected yet" },
};

const StatusBadge = ({ tone, label }: { tone: Tone; label?: string | undefined }) => {
  const t = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium ${t.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {label ?? t.text}
    </span>
  );
};

const OpsRow = ({ label, tone, badgeLabel }: { label: string; tone: Tone; badgeLabel?: string | undefined }) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <span className="text-[12px] text-slate-300">{label}</span>
    <StatusBadge tone={tone} label={badgeLabel} />
  </div>
);

const ActionCard = ({ icon, title, description, href }: { icon: ReactNode; title: string; description: string; href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-sky-400/40 hover:bg-white/[0.04]"
  >
    <div className="flex items-start justify-between gap-2">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/20 to-violet-500/20 text-sky-200">
        {icon}
      </span>
      <ArrowUpRight className="h-4 w-4 text-slate-500 transition group-hover:text-sky-300" />
    </div>
    <p className="mt-3 text-sm font-semibold text-white">{title}</p>
    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{description}</p>
  </a>
);

const DeepLink = ({ label, path, href }: { label: string; path: string; href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="group flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 transition hover:border-sky-400/40 hover:bg-white/[0.05]"
  >
    <span className="min-w-0">
      <span className="block truncate text-[12px] font-medium text-slate-200">{label}</span>
      <span className="block truncate font-mono text-[10px] text-slate-500">{path}</span>
    </span>
    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500 transition group-hover:text-sky-300" />
  </a>
);

/* --------------------------------------------------------------------- page */

export default async function PalePage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const health = await getPaleBackendHealth();
  const backendTone: Tone =
    health.status === "live" ? "live" : health.status === "down" ? "off" : "pending";
  const backendLabel =
    health.status === "live"
      ? "Live"
      : health.status === "down"
        ? "Down"
        : "Unreachable";
  const uptimeText =
    health.status === "live" ? formatUptime(health.uptimeSeconds) : "—";

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/pale"
      title="Pale"
      subtitle="Phone-first mobile messaging app of the AnnouPale ecosystem — backend health, identity model, and OTP delivery."
      actions={
        <>
          <StatusBadge tone={backendTone} label={`Backend ${backendLabel}`} />
          <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            Production
          </span>
        </>
      }
    >
      {/* Branded hero */}
      <SectionCard className="border-sky-400/15 bg-gradient-to-br from-sky-500/[0.06] via-violet-500/[0.04] to-fuchsia-500/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              <Image src="/brands/products/pale.png" alt="Pale logo" fill sizes="56px" className="object-contain p-1.5" />
            </span>
            <div>
              <p className="text-lg font-semibold text-white">Pale</p>
              <p className="text-[12px] text-slate-400">Phone-First Messaging App · com.migrateck.pale</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Backend (pale-api)</p>
            <p className="text-sm font-semibold text-white">{backendLabel}</p>
            <p className="text-[10px] text-slate-500">
              {health.status === "live" ? `uptime ${uptimeText} · ${health.detail}` : health.detail}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Action cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ActionCard
          icon={<Smartphone className="h-5 w-5" />}
          title="Google Play Listing"
          description="Pale Android app (com.migrateck.pale)."
          href={PALE_PLAY_URL}
        />
        <ActionCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Trust &amp; Safety Admin"
          description="Pale moderation runs through AnnouPale admin."
          href={ANNOUPALE_LINKS.admin}
        />
        <ActionCard
          icon={<MessageSquare className="h-5 w-5" />}
          title="Compliance Cases"
          description="Privacy, safety, security &amp; IP requests."
          href={ANNOUPALE_LINKS.complianceCases}
        />
        <ActionCard
          icon={<Globe className="h-5 w-5" />}
          title="Legal Center"
          description="Shared AnnouPale policies &amp; data rights."
          href={ANNOUPALE_LINKS.legal}
        />
      </div>

      {/* Operations cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="Backend Health">
          <div className="-mt-1 divide-y divide-white/5">
            <OpsRow label="pale-api service" tone={backendTone} badgeLabel={backendLabel} />
            <OpsRow label="Uptime" tone={health.status === "live" ? "live" : "off"} badgeLabel={uptimeText} />
            <OpsRow label="Health endpoint" tone="configured" badgeLabel="/api/health" />
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <p className="text-[10px] leading-relaxed text-slate-500">
              Live server-side probe of pale-api on app-core. No fabricated metrics — if the
              endpoint is unreachable this reports it honestly.
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Identity &amp; Access">
          <div className="-mt-1 divide-y divide-white/5">
            <OpsRow label="Phone-first OTP login" tone="enforced" />
            <OpsRow label="One account per number" tone="enforced" badgeLabel="E.164 + unique" />
            <OpsRow label="One active device per number" tone="enforced" badgeLabel="Latest wins" />
            <OpsRow label="Age gate (13+)" tone="enforced" />
            <OpsRow label="No email OTP" tone="configured" badgeLabel="By design" />
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
            A fresh login revokes other sessions, so a number can be live on only one device at a
            time. Enforced server-side in pale-api.
          </p>
        </SectionCard>

        <SectionCard title="OTP Delivery">
          <div className="-mt-1 divide-y divide-white/5">
            <OpsRow label="Provider: Telnyx Verify" tone="live" />
            <OpsRow label="SMS channel" tone="live" />
            <OpsRow label="Voice-call fallback" tone="configured" />
            <OpsRow label="Global incl. Haiti (+509)" tone="live" />
            <OpsRow label="6-digit branded code" tone="enforced" badgeLabel="Pale-AnnouPale" />
            <OpsRow label="Android zero-tap autofill" tone="pending" badgeLabel="Template pending" />
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
            One-tap autofill is live; zero-tap (SMS Retriever) activates once the Telnyx hash
            template is created — currently waiting on a Telnyx review-engine outage.
          </p>
        </SectionCard>
      </div>

      {/* Platform */}
      <SectionCard
        title="App &amp; Platform"
        subtitle="Distribution and client status for the Pale mobile app."
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          <OpsRow label="Android app (com.migrateck.pale)" tone="live" badgeLabel="Built &amp; signed" />
          <OpsRow label="Release signing key" tone="enforced" badgeLabel="MigraTeck LLC" />
          <OpsRow label="iOS app" tone="pending" badgeLabel="Planned" />
          <OpsRow label="WhatsApp OTP channel" tone="off" />
        </div>
      </SectionCard>

      {/* Deep links */}
      <SectionCard
        title="Deep Links"
        subtitle="Pale distribution + the shared AnnouPale trust surface (opens in a new tab)."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <DeepLink label="Google Play" path="store/apps/details?id=com.migrateck.pale" href={PALE_PLAY_URL} />
          <DeepLink label="AnnouPale Admin" path="/admin" href={ANNOUPALE_LINKS.admin} />
          <DeepLink label="Compliance Cases" path="/admin/compliance/cases" href={ANNOUPALE_LINKS.complianceCases} />
          <DeepLink label="Safety Report" path="/safety/report" href={ANNOUPALE_LINKS.safetyReport} />
          <DeepLink label="Privacy Request" path="/privacy/request" href={ANNOUPALE_LINKS.privacyRequest} />
          <DeepLink label="Account Deletion Help" path="/help/account-deletion" href={ANNOUPALE_LINKS.accountDeletion} />
        </div>
      </SectionCard>

      {/* Security note */}
      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          This module reads pale-api health and deep-links to Pale&apos;s distribution and the
          shared AnnouPale trust surface. It embeds no admin, passes no tokens in URLs, and grants
          no permissions — every linked surface enforces its own access controls.
        </p>
      </div>

      <p className="pt-1 text-center text-[10px] text-slate-600">
        <Fingerprint className="mr-1 inline h-3 w-3 align-[-1px]" />
        Phone-first identity · one account &amp; one device per number · MigraPanel Control Center
      </p>
    </ConsolePageShell>
  );
}
