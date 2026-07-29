import { redirect } from "next/navigation";
import { Shield, ShieldCheck, UserCog, BarChart3, Gavel, ExternalLink } from "lucide-react";

import { getSession } from "../../lib/auth";
import { AnnoupaleShell } from "../../components/annoupale/AnnoupaleShell";
import { SectionCard } from "../../components/SectionCard";
import { ANNOUPALE_BASE } from "../../lib/annoupale";

export const dynamic = "force-dynamic";

const ROLES: Array<{ key: string; label: string; detail: string; icon: React.ReactNode }> = [
  {
    key: "platform_admin",
    label: "Platform Admin",
    detail: "Full administrative access including configuration and maintenance.",
    icon: <Shield className="h-4 w-4 text-fuchsia-300" />,
  },
  {
    key: "trust_safety_admin",
    label: "Trust & Safety Admin",
    detail: "Compliance cases, appeals review, audit log, and analytics.",
    icon: <ShieldCheck className="h-4 w-4 text-emerald-300" />,
  },
  {
    key: "moderator",
    label: "Moderator",
    detail: "Moderation cases and actions (limited scope).",
    icon: <UserCog className="h-4 w-4 text-amber-300" />,
  },
  {
    key: "analyst",
    label: "Analyst",
    detail: "Read-only analytics, audit, and reporting access.",
    icon: <BarChart3 className="h-4 w-4 text-sky-300" />,
  },
  {
    key: "legal_reviewer",
    label: "Legal Reviewer",
    detail: "Legal escalations, law-enforcement requests, and attorney-review cases.",
    icon: <Gavel className="h-4 w-4 text-violet-300" />,
  },
];

const MODE_ROWS: Array<{ label: string; value: string }> = [
  { label: "Operating mode", value: "Single-operator bridge mode" },
  { label: "Identity model", value: "Server-authoritative operator" },
  { label: "Authorization", value: "AnnouPale role checks enforced on every request" },
];

export default async function AnnoupaleStaffPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  return (
    <AnnoupaleShell
      session={session}
      title="Staff & Access"
      subtitle="Staff roles that govern access to AnnouPale Trust & Operations."
    >
      <SectionCard title="Current access mode" subtitle="How this console authenticates and authorizes staff today">
        <div className="divide-y divide-white/5">
          {MODE_ROWS.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 py-2.5 text-[12px]">
              <span className="text-slate-400">{r.label}</span>
              <span className="text-right text-slate-200">{r.value}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Role management remains in AnnouPale until roster sync is available.
        </p>
      </SectionCard>

      <SectionCard title="Staff roster">
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.05] px-4 py-4 text-[12px] text-amber-200/90">
          <p className="font-medium text-amber-200">Roster not available via API yet.</p>
          <p className="mt-1 text-amber-200/80">
            AnnouPale does not currently expose a staff-roster endpoint, so this console cannot list
            individual staff members or grant/revoke roles without fabricating data. Staff and role
            management is performed directly in AnnouPale. When a read-only roster endpoint is added,
            this page will populate automatically.
          </p>
          <a
            href={`${ANNOUPALE_BASE}/admin`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-fuchsia-300 hover:text-fuchsia-200"
          >
            Manage staff in AnnouPale admin <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </SectionCard>

      <SectionCard title="Role model" subtitle="Roles enforced by AnnouPale on every staff endpoint (current + planned)">
        <div className="space-y-2">
          {ROLES.map((r) => (
            <div key={r.key} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <span className="mt-0.5">{r.icon}</span>
              <div>
                <div className="text-[13px] font-semibold text-white">
                  {r.label}{" "}
                  <span className="ml-1 font-mono text-[10px] text-slate-500">{r.key}</span>
                </div>
                <div className="text-[11px] text-slate-400">{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          The MigraPanel bridge acts as a single configured Trust &amp; Safety operator; AnnouPale
          verifies the assertion and enforces these roles on every request.
        </p>
      </SectionCard>
    </AnnoupaleShell>
  );
}
