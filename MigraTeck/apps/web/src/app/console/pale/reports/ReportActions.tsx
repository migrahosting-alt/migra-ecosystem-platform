"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, ShieldAlert, ArrowUpRight, CheckCircle2, Ban } from "lucide-react";

import { markReviewingAction } from "./actions";

const TIP = "Action wiring requires RBAC + audit log.";

/** Disabled placeholder control for not-yet-wired actions (Phase 2B+). */
const Disabled = ({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) => (
  <span title={`${label} — coming soon. ${TIP}`} className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-[10px] font-medium text-slate-600 opacity-70">
    <Icon className="h-3 w-3" /> {label}
  </span>
);

export function ReportActions({
  reportId,
  status,
  canMutate,
}: {
  reportId: string;
  status: string;
  canMutate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const alreadyReviewing = status === "reviewing";
  const canMarkReviewing = canMutate && !alreadyReviewing;

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const r = await markReviewingAction(reportId);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(r.error ?? "Action failed.");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {/* Mark reviewing — the only enabled Phase 2A action */}
      {canMarkReviewing ? (
        <button
          type="button"
          onClick={() => { setError(null); setOpen(true); }}
          className="inline-flex items-center gap-1 rounded-md border border-sky-400/30 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-200 transition hover:bg-sky-500/20"
        >
          <Eye className="h-3 w-3" /> Mark reviewing
        </button>
      ) : (
        <span
          title={alreadyReviewing ? "Already in review" : `Mark reviewing — ${TIP}`}
          className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-[10px] font-medium text-slate-600 opacity-70"
        >
          <Eye className="h-3 w-3" /> {alreadyReviewing ? "Reviewing" : "Mark reviewing"}
        </span>
      )}

      {/* Phase 2B+ — disabled placeholders */}
      <Disabled icon={CheckCircle2} label="Dismiss" />
      <Disabled icon={ArrowUpRight} label="Escalate" />
      <Disabled icon={ShieldAlert} label="Resolve" />
      <Disabled icon={Ban} label="Ban/Suspend" />

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Mark report as reviewing?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
              This will move the report into active review and create an audit log entry. No user
              account or content will be changed.
            </p>
            {error && (
              <p className="mt-3 rounded-md border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="rounded-md border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 text-[12px] font-semibold text-sky-200 transition hover:bg-sky-500/25 disabled:opacity-50"
              >
                {pending ? "Working…" : "Mark reviewing"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
