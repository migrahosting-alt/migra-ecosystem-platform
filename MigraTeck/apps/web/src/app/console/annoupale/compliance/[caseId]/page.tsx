import { redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { getSession } from "../../../lib/auth";
import { AnnoupaleShell } from "../../../components/annoupale/AnnoupaleShell";
import { SectionCard } from "../../../components/SectionCard";
import { ANNOUPALE_BASE, ANNOUPALE_LINKS } from "../../../lib/annoupale";
import {
  Field,
  LivePill,
  PanelUnavailable,
  pill,
  PRIORITY_TONE,
  STATUS_TONE,
  labelize,
  fmtDateTime,
} from "../../../components/annoupale/annoupale-ui";
import { AnnoupaleAddNoteForm } from "../../../components/AnnoupaleAddNoteForm";
import { AnnoupaleCaseTriageForm } from "../../../components/annoupale/AnnoupaleCaseTriageForm";
import { reasonLabel } from "../../../lib/annoupale/compliance-contract";
import { loadComplianceCase } from "../../../lib/annoupale/compliance-detail";
import {
  RISK_FLAG_LABELS,
  deriveCaseTimeline,
  type ComplianceCaseDetail,
} from "../../../lib/annoupale/compliance-detail-contract";

export const dynamic = "force-dynamic";

const adminCaseUrl = (caseId: string) =>
  `${ANNOUPALE_BASE}/admin/compliance/cases/${encodeURIComponent(caseId)}`;

const SOP_LINKS: Array<{ label: string; href: string }> = [
  { label: "Privacy & data requests", href: ANNOUPALE_LINKS.privacyRequest },
  { label: "Abuse & safety policy", href: ANNOUPALE_LINKS.safetyReport },
  { label: "Legal & law enforcement", href: ANNOUPALE_LINKS.legalContact },
];

function Breadcrumb({ caseId }: { caseId: string }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
      <Link href="/console/annoupale/compliance" className="hover:text-slate-300">
        Compliance Cases
      </Link>
      <span>/</span>
      <span className="font-mono text-slate-300">{caseId}</span>
    </nav>
  );
}

const TIMELINE_DOT: Record<string, string> = {
  created: "bg-emerald-400",
  note: "bg-sky-400",
  updated: "bg-slate-400",
  closed: "bg-violet-400",
};

function CaseTimeline({ d }: { d: ComplianceCaseDetail }) {
  const entries = deriveCaseTimeline(d);
  return (
    <SectionCard
      title="Case timeline"
      subtitle="Derived from this case's own fields. Exact action times live in the audit log."
    >
      {entries.length === 0 ? (
        <p className="text-[12px] text-slate-500">No timeline data on this case yet.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-white/10 pl-4">
          {entries.map((e, i) => (
            <li key={`${e.kind}-${i}`} className="relative">
              <span
                className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-[#0b1020] ${
                  TIMELINE_DOT[e.kind] ?? "bg-slate-500"
                }`}
              />
              <div className="text-[12px] font-medium text-slate-200">{e.label}</div>
              <div className="text-[11px] text-slate-500">
                {e.at ? fmtDateTime(e.at) : "Time recorded in the audit log"}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 border-t border-white/5 pt-3 text-[11px] text-slate-500">
        Full audit trail available in the{" "}
        <Link href="/console/annoupale/audit" className="text-fuchsia-300 hover:text-fuchsia-200">
          Audit Log
        </Link>
        .
      </p>
    </SectionCard>
  );
}

function DetailBody({ d }: { d: ComplianceCaseDetail }) {
  const activeFlags = RISK_FLAG_LABELS.filter((f) => d.riskFlags[f.key]);
  const allFlags = RISK_FLAG_LABELS;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {/* main column */}
      <div className="space-y-5 xl:col-span-2">
        <SectionCard>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="Category" value={labelize(d.category)} />
            <Field label="Type" value={labelize(d.requestType)} />
            <Field
              label="Priority"
              value={<span className={pill(PRIORITY_TONE, d.priority)}>{d.priority}</span>}
            />
            <Field label="Severity" value={d.severity} />
            <Field label="Status" value={<span className={pill(STATUS_TONE, d.status)}>{labelize(d.status)}</span>} />
          </div>
          <div className="mt-4 border-t border-white/5 pt-3 text-[11px] text-slate-500">
            Created {fmtDateTime(d.createdAt)}
            {d.sourceRoute && d.sourceRoute !== "—" ? ` · via ${d.sourceRoute}` : ""}
            {d.updatedAt ? ` · updated ${fmtDateTime(d.updatedAt)}` : ""}
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <SectionCard title="Requester" subtitle="Staff detail — handle with care">
            <div className="grid grid-cols-1 gap-3">
              <Field label="Name" value={d.requester.name} />
              <Field label="Email" value={d.requester.email} />
              <Field label="User / handle" value={d.requester.handle} />
            </div>
          </SectionCard>

          <SectionCard title="Target">
            <div className="grid grid-cols-1 gap-3">
              <Field label="Target handle" value={d.target.handle} />
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">URL / content</div>
                {d.target.url ? (
                  <a
                    href={d.target.url}
                    target="_blank"
                    rel="noreferrer nofollow"
                    className="break-all text-[12px] text-fuchsia-300 hover:text-fuchsia-200"
                  >
                    {d.target.url}
                  </a>
                ) : (
                  <div className="text-[12px] text-slate-200">—</div>
                )}
              </div>
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Submitted details">
          {d.details ? (
            <div className="whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/20 p-3 text-[12px] text-slate-300">
              {d.details}
            </div>
          ) : (
            <p className="text-[12px] text-slate-500">No details provided.</p>
          )}
        </SectionCard>

        <SectionCard
          title="Internal notes"
          subtitle="Staff-only · attributed to you in the AnnouPale audit"
        >
          {d.internal.internalNotes ? (
            <div className="mb-3 whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/20 p-3 text-[12px] text-slate-300">
              {d.internal.internalNotes}
            </div>
          ) : (
            <p className="mb-3 text-[12px] text-slate-500">No internal notes yet.</p>
          )}
          <AnnoupaleAddNoteForm caseId={d.caseId} />
        </SectionCard>

        {d.metadata.length > 0 && (
          <SectionCard title="Additional context">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {d.metadata.map((m) => (
                <Field key={m.key} label={labelize(m.key)} value={m.value} />
              ))}
            </div>
          </SectionCard>
        )}

        <CaseTimeline d={d} />

        <SectionCard title="Audit trail">
          <p className="mb-3 text-[12px] text-slate-400">
            Every status change, note, and close on this case is recorded in the AnnouPale audit
            log and attributed to the acting staff member.
          </p>
          <div className="flex flex-wrap gap-4 text-[12px]">
            <Link href="/console/annoupale/audit" className="text-fuchsia-300 hover:text-fuchsia-200">
              View audit log →
            </Link>
            <a
              href={adminCaseUrl(d.caseId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-fuchsia-300 hover:text-fuchsia-200"
            >
              Open in AnnouPale admin <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </SectionCard>
      </div>

      {/* right rail */}
      <div className="space-y-5">
        <SectionCard title="Risk flags">
          <div className="space-y-2">
            {allFlags.map((f) => {
              const on = d.riskFlags[f.key];
              return (
                <div key={f.key} className="flex items-center gap-2 text-[12px]">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-red-400" : "bg-slate-700"}`}
                  />
                  <span className={on ? "font-medium text-red-300" : "text-slate-500"}>
                    {f.label}
                  </span>
                </div>
              );
            })}
          </div>
          {activeFlags.length === 0 && (
            <p className="mt-2 text-[11px] text-slate-600">No risk flags on this case.</p>
          )}
        </SectionCard>

        <SectionCard title="Case actions">
          <AnnoupaleCaseTriageForm
            caseId={d.caseId}
            currentStatus={d.status}
            currentPriority={d.priority}
            currentAssignee={d.internal.assignedTo}
            isClosed={d.status === "closed"}
          />
        </SectionCard>

        <SectionCard title="SOP & legal resources">
          <div className="space-y-2">
            {SOP_LINKS.map((l) => (
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
      </div>
    </div>
  );
}

export default async function AnnoupaleCaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const { caseId } = await params;
  const result = await loadComplianceCase(caseId);
  const connected = result.status === "ok";

  return (
    <AnnoupaleShell
      session={session}
      title={result.status === "ok" ? `Case ${result.detail.caseId}` : "Compliance case"}
      breadcrumb={<Breadcrumb caseId={result.status === "ok" ? result.detail.caseId : caseId} />}
      actions={
        <LivePill
          connected={connected}
          label={
            connected
              ? "Live"
              : result.status === "not_found"
                ? "Not found"
                : "Unavailable"
          }
        />
      }
    >
      {result.status === "ok" ? (
        <DetailBody d={result.detail} />
      ) : result.status === "not_found" ? (
        <SectionCard title="Case not found">
          <p className="text-[12px] text-slate-400">
            No compliance case matches <span className="font-mono text-slate-300">{caseId}</span>.
            It may have been removed, or the identifier is incorrect.
          </p>
        </SectionCard>
      ) : (
        <SectionCard title="Case unavailable">
          <PanelUnavailable
            message={reasonLabel(result.reason)}
            fallbackHref={ANNOUPALE_LINKS.complianceCases}
            fallbackLabel="Open AnnouPale compliance admin"
          />
        </SectionCard>
      )}
    </AnnoupaleShell>
  );
}
