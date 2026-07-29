"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./SubmitButton";
import {
  closeCaseAction,
  updateCaseStatusAction,
  type CaseActionState,
} from "../lib/annoupale/status-actions";
import {
  RESOLUTION_MAX,
  SETTABLE_STATUSES,
} from "../lib/annoupale/compliance-status-contract";

const labelize = (v: string) => v.replace(/_/g, " ");

/**
 * Case actions: status update + gated close. Both mutations run in server
 * actions — the AnnouPale token never reaches the browser. Close requires
 * resolution text + an explicit confirmation checkbox (no silent close, no fake
 * success); on success the action revalidates the detail + queue.
 */
export function AnnoupaleCaseActionsForm({
  caseId,
  currentStatus,
  isClosed,
}: {
  caseId: string;
  currentStatus: string;
  isClosed: boolean;
}) {
  const [statusState, statusAction] = useActionState<
    CaseActionState | undefined,
    FormData
  >(updateCaseStatusAction, undefined);
  const [closeState, closeAction] = useActionState<
    CaseActionState | undefined,
    FormData
  >(closeCaseAction, undefined);

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

  const sel =
    "rounded-md border border-white/10 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-200";

  return (
    <div className="space-y-5">
      {/* Status update (non-close) */}
      <form action={statusAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="caseId" value={caseId} />
        <label className="flex flex-col gap-1 text-[10px] text-slate-500">
          Set status
          <select name="status" defaultValue="" className={sel}>
            <option value="" disabled>
              Choose…
            </option>
            {SETTABLE_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === currentStatus}>
                {labelize(s)}
                {s === currentStatus ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton tone="default" pendingLabel="Updating…">
          Update status
        </SubmitButton>
        {statusState ? (
          <span
            role="status"
            className={`text-[11px] ${statusState.ok ? "text-emerald-300" : "text-rose-300"}`}
          >
            {statusState.message}
          </span>
        ) : null}
      </form>

      {/* Gated close */}
      {isClosed ? (
        <p className="text-[12px] text-slate-500">
          This case is closed. Set a status above to reopen it.
        </p>
      ) : (
        <form action={closeAction} className="space-y-2 rounded-md border border-rose-400/20 bg-rose-500/5 p-3">
          <input type="hidden" name="caseId" value={caseId} />
          <div className="text-[12px] font-semibold text-rose-200">Close case</div>
          <p className="text-[10px] text-slate-400">
            Closing a case records a permanent staff action. Do not close a case
            unless the required review is complete. Resolution text is required.
          </p>
          <textarea
            name="resolution"
            required
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            maxLength={RESOLUTION_MAX}
            rows={3}
            placeholder="Resolution / action taken (required)…"
            className="w-full rounded-md border border-white/10 bg-slate-900/60 p-2 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-rose-400/40 focus:outline-none"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <label className="inline-flex items-center gap-1.5 text-slate-300">
              <input type="checkbox" name="confirm" required className="accent-rose-500" />
              I confirm the review is complete and this case can be closed.
            </label>
            <span className={resolution.length > RESOLUTION_MAX ? "text-rose-400" : ""}>
              {resolution.length}/{RESOLUTION_MAX}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <SubmitButton tone="bad" pendingLabel="Closing…">
              Close case
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
