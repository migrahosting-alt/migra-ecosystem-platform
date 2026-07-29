import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { getSession } from "../../lib/auth";
import { AnnoupaleShell } from "../../components/annoupale/AnnoupaleShell";
import { SectionCard } from "../../components/SectionCard";
import { ANNOUPALE_LINKS } from "../../lib/annoupale";
import { LivePill } from "../../components/annoupale/annoupale-ui";
import { loadAnnoupaleHealth } from "../../lib/annoupale/health";
import { loadComplianceQueue } from "../../lib/annoupale/compliance";
import { reasonLabel } from "../../lib/annoupale/compliance-contract";

export const dynamic = "force-dynamic";

const RUNBOOK: Array<{ title: string; guidance: string; href?: string; hrefLabel?: string }> = [
  {
    title: "Privacy & data requests",
    guidance:
      "Verify the requester, scope the data, and action within the statutory window. Track every step on the case.",
    href: ANNOUPALE_LINKS.privacyRequest,
    hrefLabel: "Intake form",
  },
  {
    title: "Safety reports",
    guidance:
      "Triage by severity first; child-safety and immediate-danger cases are escalated ahead of the queue.",
    href: ANNOUPALE_LINKS.safetyReport,
    hrefLabel: "Intake form",
  },
  {
    title: "Security & IP reports",
    guidance:
      "Confirm reproducibility for security; validate ownership for IP/copyright. Record the action taken on the case.",
    href: ANNOUPALE_LINKS.securityReport,
    hrefLabel: "Security intake",
  },
  {
    title: "Appeal review",
    guidance:
      "Review the original action and the appellant's statement. Appeal approve/reject is performed in AnnouPale.",
    href: ANNOUPALE_LINKS.adminAppeals,
    hrefLabel: "Appeals queue",
  },
  {
    title: "Closing a case",
    guidance:
      "A case may only be closed with a recorded resolution. Closures are attributed to the acting staff member in the audit log.",
  },
  {
    title: "Legal escalation",
    guidance:
      "Attorney-review and law-enforcement matters go to the legal contact; do not action externally without legal sign-off.",
    href: ANNOUPALE_LINKS.legalContact,
    hrefLabel: "Legal contact",
  },
  {
    title: "Mail & TLS monitoring",
    guidance:
      "Compliance notifications depend on healthy mail delivery — keep SPF/DKIM and TLS certificates for notification domains monitored.",
  },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 text-[12px] last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-200">{value}</span>
    </div>
  );
}

export default async function AnnoupaleSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  // Real connectivity probes — no secrets read or shown.
  const [health, bridge] = await Promise.all([
    loadAnnoupaleHealth(),
    loadComplianceQueue({}),
  ]);

  return (
    <AnnoupaleShell
      session={session}
      title="Settings"
      subtitle="AnnouPale connection status and console configuration. No secrets are displayed."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard
          title="Staff bridge"
          actions={<LivePill connected={bridge.connected} label={bridge.connected ? "Connected" : "Unavailable"} />}
        >
          <Row label="Native compliance connection" value={bridge.connected ? "Connected" : "Unavailable"} />
          {!bridge.connected && <Row label="Reason" value={<span className="text-amber-300">{reasonLabel(bridge.reason)}</span>} />}
          <Row label="Identity model" value="Server-authoritative operator" />
          <Row label="Token exposure" value="Server-only (never in browser)" />
          <p className="mt-3 text-[11px] text-slate-500">
            MigraPanel signs a short-lived Ed25519 assertion for the configured Trust &amp; Safety
            operator and exchanges it for a per-operator staff token server-side. AnnouPale verifies
            the signature, issuer, and audience and enforces its own role checks.
          </p>
        </SectionCard>

        <SectionCard
          title="Platform health"
          actions={
            <LivePill
              connected={health.reachable && health.status === "operational"}
              label={health.reachable ? (health.status === "operational" ? "Operational" : "Degraded") : "Unreachable"}
            />
          }
        >
          {health.reachable ? (
            <>
              <Row label="Status" value={health.status === "operational" ? "All systems operational" : "Degraded"} />
              {health.checks.map((c) => (
                <Row key={c.name} label={c.name} value={c.ok ? "ok" : <span className="text-rose-300">fail</span>} />
              ))}
              {health.checkedAt && <Row label="Checked" value={health.checkedAt.replace("T", " ").slice(0, 19) + "Z"} />}
            </>
          ) : (
            <p className="py-4 text-[12px] text-amber-200/80">The platform health endpoint is unreachable from the console.</p>
          )}
          <p className="mt-3 text-[11px] text-slate-500">
            Uptime percentage is not exposed by the health endpoint, so it is not shown here.
          </p>
        </SectionCard>
      </div>

      <SectionCard title="Access URLs">
        <Row
          label="Trust & Operations console"
          value={<span className="break-all font-mono text-slate-300">console.migrateck.com/console/annoupale</span>}
        />
        <Row
          label="Short alias"
          value={<span className="break-all font-mono text-slate-300">console.migrateck.com/annoupale</span>}
        />
      </SectionCard>

      <SectionCard title="SOP & legal resources">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { label: "Legal center", href: ANNOUPALE_LINKS.legal },
            { label: "Privacy requests", href: ANNOUPALE_LINKS.privacyRequest },
            { label: "Legal & law-enforcement contact", href: ANNOUPALE_LINKS.legalContact },
          ].map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-slate-300 transition hover:border-fuchsia-400/30 hover:text-white"
            >
              {l.label}
              <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
            </a>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Operational runbook"
        subtitle="How staff should handle each request type. Links open the relevant AnnouPale intake or admin surface."
      >
        <div className="divide-y divide-white/5">
          {RUNBOOK.map((r) => (
            <div key={r.title} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-white">{r.title}</span>
                {r.href && (
                  <a
                    href={r.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-fuchsia-300 hover:text-fuchsia-200"
                  >
                    {r.hrefLabel ?? "Open"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-slate-400">{r.guidance}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </AnnoupaleShell>
  );
}
