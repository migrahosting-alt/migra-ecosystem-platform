"use client";

import { useActionState } from "react";
import { FilePenLine, LockKeyhole, MessageSquarePlus, UserRoundCheck, UsersRound } from "lucide-react";
import { SubmitButton } from "../../../components/SubmitButton";
import {
  addGuardIncidentNoteAction,
  assignGuardIncidentAction,
  readGuardAssignmentOptionsAction,
  updateGuardIncidentStatusAction,
  type GuardAssignmentOptionsState,
  type GuardOperatorFormState,
} from "../../actions";

const statuses=["open","investigating","resolved","suppressed"] as const;

export function IncidentOperatorPanel({
  incidentId,
  currentStatus,
  currentAssignedTo,
  enabled,
}:{
  incidentId:string;
  currentStatus:string;
  currentAssignedTo:string|null;
  enabled:boolean;
}){
  const [noteState,noteAction]=useActionState<GuardOperatorFormState|undefined,FormData>(addGuardIncidentNoteAction,undefined);
  const [statusState,statusAction]=useActionState<GuardOperatorFormState|undefined,FormData>(updateGuardIncidentStatusAction,undefined);
  const [assignmentState,assignmentAction]=useActionState<GuardOperatorFormState|undefined,FormData>(assignGuardIncidentAction,undefined);
  const [directoryState,directoryAction]=useActionState<GuardAssignmentOptionsState|undefined,FormData>(readGuardAssignmentOptionsAction,undefined);
  if(!enabled){
    return <section className="rounded-md border border-amber-400/20 bg-amber-500/[0.04] p-4">
      <div className="flex gap-3"><LockKeyhole size={18} className="mt-0.5 shrink-0 text-amber-200"/><div><h2 className="text-sm font-semibold text-white">Operator actions are fail-closed</h2><p className="mt-1 text-xs leading-5 text-slate-400">This console can inspect incident authority, but signed MigraPanel → MigraGuard operator federation has not been provisioned in this runtime. Status, assignment, and note controls remain disabled.</p></div></div>
    </section>;
  }

  return <section className="overflow-hidden rounded-md border border-white/10">
    <div className="border-b border-white/10 px-4 py-3"><div className="flex items-center gap-2"><FilePenLine size={17} className="text-sky-300"/><h2 className="text-sm font-semibold text-white">Operator case controls</h2></div><p className="mt-1 text-[11px] text-slate-500">Every action is signed for this console session, replay-protected by MigraGuard, tenant-bound, and audit-backed.</p></div>
    <div className="grid gap-px bg-white/10 lg:grid-cols-[.9fr_1.1fr]">
      <div className="space-y-5 bg-slate-950 p-4">
        <form action={statusAction}>
          <input type="hidden" name="incidentId" value={incidentId}/>
          <label className="text-xs font-medium text-slate-300" htmlFor="guard-incident-status">Incident state</label>
          <select id="guard-incident-status" name="status" defaultValue={statuses.includes(currentStatus as typeof statuses[number])?currentStatus:"open"} className="mt-2 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-sky-400/40">
            {statuses.map(value=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}
          </select>
          <div className="mt-3 flex items-center gap-3"><SubmitButton size="sm" tone="accent" pendingLabel="Signing…">Apply state</SubmitButton>{statusState?<span role="status" className={`text-[10px] ${statusState.ok?"text-emerald-300":"text-rose-300"}`}>{statusState.message}</span>:null}</div>
          <p className="mt-3 text-[10px] leading-4 text-slate-600">Resolving records server-owned resolver identity and timestamp. Reopening clears stale resolution authority.</p>
        </form>

        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2"><UsersRound size={14} className="text-cyan-300"/><h3 className="text-xs font-medium text-slate-300">Incident owner</h3></div><p className="mt-1 text-[10px] text-slate-600">Assignable operators are fetched only through a signed tenant-bound directory read.</p></div><form action={directoryAction}><input type="hidden" name="incidentId" value={incidentId}/><SubmitButton size="sm" tone="ghost" pendingLabel="Loading…">Load operators</SubmitButton></form></div>
          {directoryState?.ok&&directoryState.operators?.length?<form action={assignmentAction} className="mt-3">
            <input type="hidden" name="incidentId" value={incidentId}/>
            <select name="assignedTo" required defaultValue={currentAssignedTo&&directoryState.operators.some(operator=>operator.userId===currentAssignedTo)?currentAssignedTo:""} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/40">
              <option value="" disabled>Select operator…</option>
              {directoryState.operators.map(operator=><option key={operator.userId} value={operator.userId}>{operator.name} · {operator.role}{operator.username?` · @${operator.username}`:""}</option>)}
            </select>
            <div className="mt-3 flex items-center gap-3"><SubmitButton size="sm" tone="accent" pendingLabel="Assigning…"><UserRoundCheck size={12}/>Assign incident</SubmitButton>{assignmentState?<span role="status" className={`text-[10px] ${assignmentState.ok?"text-emerald-300":"text-rose-300"}`}>{assignmentState.message}</span>:null}</div>
          </form>:directoryState?<p role="status" className={`mt-3 text-[10px] ${directoryState.ok?"text-slate-500":"text-rose-300"}`}>{directoryState.message}</p>:null}
        </div>
      </div>

      <form action={noteAction} className="bg-slate-950 p-4">
        <input type="hidden" name="incidentId" value={incidentId}/>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-300" htmlFor="guard-incident-note"><MessageSquarePlus size={14} className="text-fuchsia-300"/>Internal incident note</label>
        <textarea key={noteState?.ok?noteState.ts:"draft"} id="guard-incident-note" name="note" required maxLength={4000} rows={7} defaultValue="" placeholder="Record investigation context, decision rationale, or handoff notes. Never paste passwords, tokens, or private keys." className="mt-2 w-full resize-y rounded-md border border-white/10 bg-slate-900 p-3 text-xs leading-5 text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/40"/>
        <div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-600">Note content stays in the incident ledger; audit metadata stores only its length.</span><span className="text-[10px] text-slate-600">Max 4,000 characters</span></div>
        <div className="mt-3 flex items-center gap-3"><SubmitButton size="sm" tone="accent" pendingLabel="Signing…">Add audited note</SubmitButton>{noteState?<span role="status" className={`text-[10px] ${noteState.ok?"text-emerald-300":"text-rose-300"}`}>{noteState.message}</span>:null}</div>
      </form>
    </div>
  </section>;
}
