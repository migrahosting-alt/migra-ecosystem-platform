"use server";

import { revalidatePath } from "next/cache";
import { performGuardOperatorAction } from "../lib/migraguard/operator-actions";

export type GuardOperatorFormState = {
  ok: boolean;
  message: string;
  ts: number;
};

export type GuardIncidentNoteView = {
  noteId:string;
  userId:string;
  note:string;
  truncated:boolean;
  createdAt:string;
};

export type GuardIncidentNotesState = {
  ok:boolean;
  message:string;
  ts:number;
  notes?:GuardIncidentNoteView[];
};

export type GuardAssignableOperator = {
  userId:string;
  name:string;
  username:string|null;
  role:"owner"|"admin"|"member";
};

export type GuardAssignmentOptionsState = {
  ok:boolean;
  message:string;
  ts:number;
  operators?:GuardAssignableOperator[];
};

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function state(ok:boolean,message:string):GuardOperatorFormState{
  return {ok,message,ts:Date.now()};
}

function id(form:FormData,name:string):string|null{
  const value=String(form.get(name)||"").trim();
  return UUID_RE.test(value)?value:null;
}

export async function readGuardIncidentNotesAction(
  _previous: GuardIncidentNotesState | undefined,
  form: FormData,
):Promise<GuardIncidentNotesState>{
  const incidentId=id(form,"incidentId");
  if(!incidentId)return {ok:false,message:"Invalid incident.",ts:Date.now()};
  const result=await performGuardOperatorAction({
    action:"incident.notes.read",
    targetId:incidentId,
    parameters:{},
  });
  if(!result.ok)return {ok:false,message:result.error,ts:Date.now()};
  const raw=result.data.notes;
  if(!Array.isArray(raw)||raw.length>100)return {ok:false,message:"MigraGuard returned an invalid note projection.",ts:Date.now()};
  const notes:GuardIncidentNoteView[]=[];
  for(const value of raw){
    if(!value||typeof value!=="object"||Array.isArray(value))return {ok:false,message:"MigraGuard returned an invalid note projection.",ts:Date.now()};
    const row=value as Record<string,unknown>;
    const noteId=typeof row.note_id==="string"?row.note_id:"";
    const userId=typeof row.user_id==="string"?row.user_id:"";
    const note=typeof row.note==="string"?row.note:"";
    const createdAt=typeof row.created_at==="string"?row.created_at:"";
    if(!UUID_RE.test(noteId)||!UUID_RE.test(userId)||note.length>4000||!createdAt||Number.isNaN(Date.parse(createdAt)))return {ok:false,message:"MigraGuard returned an invalid note projection.",ts:Date.now()};
    notes.push({noteId,userId,note,truncated:row.truncated===true,createdAt:new Date(createdAt).toISOString()});
  }
  return {ok:true,message:notes.length?`Loaded ${notes.length} audited incident note${notes.length===1?"":"s"}.`:"No internal incident notes are recorded.",ts:Date.now(),notes};
}

export async function readGuardAssignmentOptionsAction(
  _previous: GuardAssignmentOptionsState | undefined,
  form: FormData,
):Promise<GuardAssignmentOptionsState>{
  const incidentId=id(form,"incidentId");
  if(!incidentId)return {ok:false,message:"Invalid incident.",ts:Date.now()};
  const result=await performGuardOperatorAction({
    action:"incident.assignment.options.read",
    targetId:incidentId,
    parameters:{},
  });
  if(!result.ok)return {ok:false,message:result.error,ts:Date.now()};
  const raw=result.data.operators;
  if(!Array.isArray(raw)||raw.length>200)return {ok:false,message:"MigraGuard returned an invalid operator directory.",ts:Date.now()};
  const operators:GuardAssignableOperator[]=[];
  for(const value of raw){
    if(!value||typeof value!=="object"||Array.isArray(value))return {ok:false,message:"MigraGuard returned an invalid operator directory.",ts:Date.now()};
    const row=value as Record<string,unknown>;
    const userId=typeof row.user_id==="string"?row.user_id:"";
    const fullName=typeof row.full_name==="string"?row.full_name.trim():"";
    const username=typeof row.username==="string"?row.username.trim():null;
    const role=typeof row.role==="string"?row.role:"";
    if(!UUID_RE.test(userId)||!["owner","admin","member"].includes(role))return {ok:false,message:"MigraGuard returned an invalid operator directory.",ts:Date.now()};
    const name=(fullName||username||`Operator ${userId.slice(0,8)}`).slice(0,255);
    operators.push({userId,name,username:username?username.slice(0,100):null,role:role as GuardAssignableOperator["role"]});
  }
  return {ok:true,message:operators.length?`Loaded ${operators.length} assignable operator${operators.length===1?"":"s"}.`:"No assignable operators are available.",ts:Date.now(),operators};
}

export async function addGuardIncidentNoteAction(
  _previous: GuardOperatorFormState | undefined,
  form: FormData,
):Promise<GuardOperatorFormState>{
  const incidentId=id(form,"incidentId");
  const note=String(form.get("note")||"").trim();
  if(!incidentId)return state(false,"Invalid incident.");
  if(!note||note.length>4000)return state(false,"Note must be between 1 and 4000 characters.");
  const result=await performGuardOperatorAction({
    action:"incident.note.add",
    targetId:incidentId,
    parameters:{note},
  });
  if(!result.ok)return state(false,result.error);
  revalidatePath(`/console/migraguard/incidents/${incidentId}`);
  revalidatePath("/console/migraguard/incidents");
  revalidatePath("/console/migraguard/forensics");
  revalidatePath("/console/migraguard/audit");
  return state(true,"Internal incident note recorded and audited.");
}

export async function updateGuardIncidentStatusAction(
  _previous: GuardOperatorFormState | undefined,
  form: FormData,
):Promise<GuardOperatorFormState>{
  const incidentId=id(form,"incidentId");
  const status=String(form.get("status")||"");
  if(!incidentId)return state(false,"Invalid incident.");
  if(!["open","investigating","resolved","suppressed"].includes(status))return state(false,"Invalid incident state.");
  const result=await performGuardOperatorAction({
    action:"incident.status.update",
    targetId:incidentId,
    parameters:{status},
  });
  if(!result.ok)return state(false,result.error);
  revalidatePath(`/console/migraguard/incidents/${incidentId}`);
  revalidatePath("/console/migraguard/incidents");
  revalidatePath("/console/migraguard/audit");
  return state(true,`Incident moved to ${status.replaceAll("_"," ")}.`);
}

export async function assignGuardIncidentAction(
  _previous: GuardOperatorFormState | undefined,
  form: FormData,
):Promise<GuardOperatorFormState>{
  const incidentId=id(form,"incidentId");
  const assignedTo=id(form,"assignedTo");
  if(!incidentId||!assignedTo)return state(false,"A valid incident and operator are required.");
  const result=await performGuardOperatorAction({
    action:"incident.assign",
    targetId:incidentId,
    parameters:{assignedTo},
  });
  if(!result.ok)return state(false,result.error);
  revalidatePath(`/console/migraguard/incidents/${incidentId}`);
  revalidatePath("/console/migraguard/incidents");
  revalidatePath("/console/migraguard/audit");
  return state(true,"Incident assignment updated and audited.");
}

export async function acknowledgeGuardProtectionAlertAction(
  _previous: GuardOperatorFormState | undefined,
  form: FormData,
):Promise<GuardOperatorFormState>{
  const alertId=id(form,"alertId");
  if(!alertId)return state(false,"Invalid protection alert.");
  const result=await performGuardOperatorAction({
    action:"protection_alert.acknowledge",
    targetId:alertId,
    parameters:{},
  });
  if(!result.ok)return state(false,result.error);
  revalidatePath("/console/migraguard/protection");
  revalidatePath("/console/migraguard/response");
  revalidatePath("/console/migraguard/audit");
  return state(true,"Protection decision acknowledged for this operator session.");
}

export async function requestGuardProtectionResponseAction(
  _previous: GuardOperatorFormState | undefined,
  form: FormData,
):Promise<GuardOperatorFormState>{
  const alertId=id(form,"alertId");
  const playbookId=id(form,"playbookId");
  const agentId=id(form,"agentId");
  const ttlRaw=Number(form.get("ttlMinutes")||30);
  const ttlMinutes=Number.isInteger(ttlRaw)&&ttlRaw>=5&&ttlRaw<=60?ttlRaw:30;
  if(!alertId||!playbookId||!agentId)return state(false,"A valid alert, playbook, and target agent are required.");
  const result=await performGuardOperatorAction({
    action:"protection.response.request",
    targetId:alertId,
    parameters:{playbookId,agentId,scope:{},parameters:{},ttlMinutes},
  });
  if(!result.ok)return state(false,result.error);
  revalidatePath("/console/migraguard/protection");
  revalidatePath("/console/migraguard/response");
  revalidatePath("/console/migraguard/audit");
  return state(true,"Governed response request created. Execution remains disabled until approval authority is satisfied.");
}
