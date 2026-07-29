"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "../SubmitButton";
import {
  closeCaseAction,
  updateCaseAction,
  type CaseActionState,
} from "../../lib/annoupale/status-actions";
import {
  RESOLUTION_MAX,
  SETTABLE_STATUSES,
} from "../../lib/annoupale/compliance-status-contract";
import { PRIORITY_OPTIONS } from "../../lib/annoupale/compliance-contract";

const labelize = (v: string) => v.replace(/_/g, " ");

/**
 * Right-rail case triage: combined status + priority save, plus a gated close.
 * Both mutations run server-side (the AnnouPale token never reaches the
 * browser). Assignment is intentionally read-only — there is no staff-roster API
 * to populate an assignee picker, so assignment stays in AnnouPale. Close
 * requires resolution text + an explicit confirmation (no silent close, no fake
 * success). On success the action revalidates the detail + queue.
 */
export function AnnoupaleCaseTriageForm({
  caseId,
  currentStatus,
  currentPriority,
  currentAssignee,
  isClosed,
}: {
  caseId: string;
  currentStatus: string;
  currentPriority: string;
  currentAssignee: string;
  isClosed: boolean;
}) {
  const [saveState, saveAction] = useActionState<CaseActionState | undefined, FormData>(
    updateCaseAction,
    undefined,
  );
  const [closeState, closeAction] = useActionState<CaseActionState | undefined, FormData>(
    closeCaseAction,
    undefined,
  );

  const [resolution, setResolution] = useState("");
  const [lastTs, setLastTs] = useState(0);
  // Clear the field once per successful submit. This ADJUSTS STATE DURING RENDER rather
  // than in an effect: the effect form re-rendered a second time after paint, which is the
  // cascading-render pattern the lint rule rejects. React sanctions this guarded
  // during-render update for exactly this "reset when an input changes" case — the guard on
  // the timestamp is what keeps it from looping.
  if (closeState?.ok && closeState.ts !== lastTs) {
    setLastTs(closeState.ts);
    setResolution("");
  }

  const lbl = "text-[10px] uppercase tracking-wide text-slate-500";
  const sel =
    "w-full rounded-md border border-white/10 bg-slate-900/60 px-2 py-1.5 text-[12px] text-slate-200 focus:border-fuchsia-400/40 focus:outline-none";

  return (
    <div className="space-y-5">
      {/* Case Actions: assignee (read-only) + status + priority + save */}
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="caseId" value={caseId} />

        <div className="space-y-1">
          <div className={lbl}>Assigned to</div>
          <div className="flex items-center justify-between rounded-md border border-white/10 bg-slate-900/40 px-2 py-1.5 text-[12px] text-slate-300">
            <span>{currentAssignee || "Unassigned"}</span>
            <span className="text-[10px] text-slate-600">managed in AnnouPale</span>
          </div>
        </div>

        <label className="block space-y-1">
          <span className={lbl}>Status</span>
          <select name="status" defaultValue="" className={sel}>
            <option value="">Keep current ({labelize(currentStatus)})</option>
            {SETTABLE_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === currentStatus}>
                {labelize(s)}
                {s === currentStatus ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className={lbl}>Priority</span>
          <select name="priority" defaultValue="" className={sel}>
            <option value="">Keep current ({labelize(currentPriority)})</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p} disabled={p === currentPriority}>
                {labelize(p)}
                {p === currentPriority ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3">
          <SubmitButton tone="accent" pendingLabel="Saving…">
            Save Changes
          </SubmitButton>
          {saveState ? (
            <span
              role="status"
              className={`text-[11px] ${saveState.ok ? "text-emerald-300" : "text-rose-300"}`}
            >
              {saveState.message}
            </span>
          ) : null}
        </div>
      </form>

      {/* Action Taken + gated close */}
      {isClosed ? (
        <p className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-slate-500">
          This case is closed. Set a status above to reopen it.
        </p>
      ) : (
        <form action={closeAction} className="space-y-2 rounded-md border border-rose-400/20 bg-rose-500/5 p-3">
          <input type="hidden" name="caseId" value={caseId} />
          <div className="text-[12px] font-semibold text-rose-200">Close case</div>
          <p className="text-[10px] text-slate-400">
            Closing records a permanent staff action. Resolution / action-taken text is required.
          </p>
          <textarea
            name="resolution"
            required
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            maxLength={RESOLUTION_MAX}
            rows={3}
            placeholder="Action taken / resolution (required)…"
            className="w-full rounded-md border border-white/10 bg-slate-900/60 p-2 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-rose-400/40 focus:outline-none"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <label className="inline-flex items-center gap-1.5 text-slate-300">
              <input type="checkbox" name="confirm" required className="accent-rose-500" />
              I confirm the review is complete.
            </label>
            <span className={resolution.length > RESOLUTION_MAX ? "text-rose-400" : ""}>
              {resolution.length}/{RESOLUTION_MAX}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <SubmitButton tone="bad" pendingLabel="Closing…">
              Close Case
            </SubmitButton>
            {closeState ? (
              <span
                role="status"
                className={`text-[11px] ${closeState.ok ? "text-emerald-300" : "text-rose-300"}`}
              >
                {closeState.message}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
