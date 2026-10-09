"use client";

import { useActionState } from "react";
import { Gavel, ShieldCheck } from "lucide-react";
import { SubmitButton } from "../../components/SubmitButton";
import {
  acknowledgeGuardProtectionAlertAction,
  requestGuardProtectionResponseAction,
  type GuardOperatorFormState,
} from "../actions";

type Playbook={
  id:string;
  name:string;
  category:string|null;
  version:number;
  requiresApproval:boolean;
};

export function ProtectionAlertAction({
  alertId,
  agentId,
  executionRequestId,
  playbooks,
  enabled,
}:{
  alertId:string;
  agentId:string;
  executionRequestId:string|null;
  playbooks:Playbook[];
  enabled:boolean;
}){
  const [ackState,ackAction]=useActionState<GuardOperatorFormState|undefined,FormData>(acknowledgeGuardProtectionAlertAction,undefined);
  const [responseState,responseAction]=useActionState<GuardOperatorFormState|undefined,FormData>(requestGuardProtectionResponseAction,undefined);
  if(!enabled)return <span className="text-[10px] text-slate-600">federation off</span>;

  return <div className="min-w-48 space-y-2">
    <form action={ackAction}>
      <input type="hidden" name="alertId" value={alertId}/>
      <SubmitButton size="sm" tone="ghost" pendingLabel="Signing…"><ShieldCheck size={12}/>Acknowledge</SubmitButton>
      {ackState?<p role="status" className={`mt-1 max-w-52 text-[9px] leading-3 ${ackState.ok?"text-emerald-300":"text-rose-300"}`}>{ackState.message}</p>:null}
    </form>

    {!executionRequestId&&playbooks.length>0?<form action={responseAction} className="space-y-1.5 border-t border-white/10 pt-2">
      <input type="hidden" name="alertId" value={alertId}/>
      <input type="hidden" name="agentId" value={agentId}/>
      <input type="hidden" name="ttlMinutes" value="30"/>
      <select name="playbookId" required defaultValue="" className="w-full rounded border border-white/10 bg-slate-950 px-2 py-1.5 text-[10px] text-slate-300 outline-none focus:border-amber-400/40">
        <option value="" disabled>Select governed response…</option>
        {playbooks.map(playbook=><option key={playbook.id} value={playbook.id}>{playbook.name} · v{playbook.version}{playbook.requiresApproval?" · approval":""}</option>)}
      </select>
      <SubmitButton size="sm" tone="warn" pendingLabel="Requesting…"><Gavel size={12}/>Request response</SubmitButton>
      {responseState?<p role="status" className={`max-w-52 text-[9px] leading-3 ${responseState.ok?"text-emerald-300":"text-rose-300"}`}>{responseState.message}</p>:null}
      <p className="max-w-52 text-[9px] leading-3 text-slate-600">Acknowledge first. This creates a governed request only; it cannot execute remediation.</p>
    </form>:null}
  </div>;
}
