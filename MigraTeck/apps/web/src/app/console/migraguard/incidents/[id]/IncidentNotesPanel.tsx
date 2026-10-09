"use client";

import { useActionState } from "react";
import { Eye, LockKeyhole, MessageSquareText } from "lucide-react";
import { SubmitButton } from "../../../components/SubmitButton";
import {
  readGuardIncidentNotesAction,
  type GuardIncidentNotesState,
} from "../../actions";

function when(value:string){
  try{return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}
  catch{return value;}
}

export function IncidentNotesPanel({incidentId,enabled}:{incidentId:string;enabled:boolean}){
  const [state,action]=useActionState<GuardIncidentNotesState|undefined,FormData>(readGuardIncidentNotesAction,undefined);

  return <section className="overflow-hidden rounded-md border border-white/10">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div><div className="flex items-center gap-2"><MessageSquareText size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Sensitive incident notes</h2></div><p className="mt-1 text-[11px] leading-4 text-slate-500">Note contents are not part of the broad machine-read model. Viewing them requires a new signed, one-shot operator assertion and creates a read-audit record.</p></div>
      {enabled?<form action={action}><input type="hidden" name="incidentId" value={incidentId}/><SubmitButton size="sm" tone="ghost" pendingLabel="Authorizing…"><Eye size={12}/>Load notes</SubmitButton></form>:<span className="inline-flex items-center gap-1.5 rounded border border-amber-400/20 bg-amber-500/[0.05] px-2 py-1 text-[10px] text-amber-200"><LockKeyhole size={11}/>Federation required</span>}
    </div>

    {!enabled?<p className="p-5 text-xs leading-5 text-slate-500">Notes remain withheld until the MigraPanel signing key, MigraGuard public key, and <code className="text-slate-400">operator:act</code> credential are provisioned.</p>:state?.ok?<div>
      <div className="border-b border-white/10 px-4 py-2 text-[10px] text-emerald-300">{state.message}</div>
      {!state.notes?.length?<p className="p-5 text-sm text-slate-400">No internal notes are recorded.</p>:<ol className="divide-y divide-white/10">{state.notes.map(note=><li key={note.noteId} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] text-slate-600">operator {note.userId.slice(0,8)}…</span><time dateTime={note.createdAt} className="text-[10px] text-slate-600">{when(note.createdAt)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{note.note}</p>{note.truncated?<p className="mt-2 text-[10px] text-amber-300">Display bounded to the first 4,000 characters.</p>:null}</li>)}</ol>}
    </div>:state?<p role="status" className="p-4 text-xs text-rose-300">{state.message}</p>:<p className="p-5 text-xs leading-5 text-slate-500">Not loaded. No sensitive note content has been requested in this page session.</p>}
  </section>;
}
