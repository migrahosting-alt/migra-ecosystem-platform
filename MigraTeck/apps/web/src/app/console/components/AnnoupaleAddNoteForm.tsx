"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./SubmitButton";
import {
  addInternalNoteAction,
  type AddNoteState,
} from "../lib/annoupale/note-actions";
import { NOTE_MAX } from "../lib/annoupale/compliance-note-contract";

/**
 * Add-internal-note form for the compliance case detail page.
 *
 * Client component, but the mutation runs entirely in the server action
 * (addInternalNoteAction): the AnnouPale token never reaches the browser. On
 * success the action revalidates the detail page, so the read-only internal
 * notes display below refreshes with the new entry — no optimistic fake success.
 */
export function AnnoupaleAddNoteForm({ caseId }: { caseId: string }) {
  const [state, formAction] = useActionState<AddNoteState | undefined, FormData>(
    addInternalNoteAction,
    undefined,
  );
  const [value, setValue] = useState("");
  const [lastTs, setLastTs] = useState(0);
  // Clear the field once per successful submit. This ADJUSTS STATE DURING RENDER rather
  // than in an effect: the effect form re-rendered a second time after paint, which is the
  // cascading-render pattern the lint rule rejects. React sanctions this guarded
  // during-render update for exactly this "reset when an input changes" case — the guard on
  // the timestamp is what keeps it from looping.
  if (state?.ok && state.ts !== lastTs) {
    setLastTs(state.ts);
    setValue("");
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="caseId" value={caseId} />
      <textarea
        name="note"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={NOTE_MAX}
        rows={4}
        placeholder="Internal note — visible to staff only."
        className="w-full rounded-md border border-white/10 bg-slate-900/60 p-2 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-400/40 focus:outline-none"
      />
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>
          Internal note — visible to staff only. Do not include passwords, private
          keys, or unnecessary sensitive data.
        </span>
        <span className={value.length > NOTE_MAX ? "text-rose-400" : ""}>
          {value.length}/{NOTE_MAX}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton tone="accent" pendingLabel="Saving…">
          Add internal note
        </SubmitButton>
        {state ? (
          <span
            role="status"
            className={`text-[11px] ${state.ok ? "text-emerald-300" : "text-rose-300"}`}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
