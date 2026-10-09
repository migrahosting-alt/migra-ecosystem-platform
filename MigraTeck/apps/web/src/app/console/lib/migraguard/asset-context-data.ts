import "server-only";
import { getSession } from "../auth";
import { fetchAssetDetail, fetchTelemetryOverview, type OperatorAssetDetail, type OperatorTelemetryOverview } from "./operator-client";

type Result<T>={state:"ready";data:T}|{state:"not-configured"|"unavailable"|"forbidden"};

function authorizedSession(session:Awaited<ReturnType<typeof getSession>>){
  return !!session
    && session.exp*1000>Date.now()
    && !!process.env.CONSOLE_ADMIN_EMAIL
    && session.email.trim().toLowerCase()===process.env.CONSOLE_ADMIN_EMAIL.trim().toLowerCase();
}

function config(){
  const origin=process.env.MIGRAGUARD_API_URL;
  const credential=process.env.MIGRAGUARD_CONSOLE_API_CREDENTIAL;
  return origin&&credential?{origin,credential}:null;
}

export async function loadGuardAssetDetail(id:string):Promise<Result<OperatorAssetDetail>>{
  const session=await getSession();
  if(!authorizedSession(session))return {state:"forbidden"};
  const c=config();
  if(!c)return {state:"not-configured"};
  try{return {state:"ready",data:await fetchAssetDetail({...c,id})};}
  catch{return {state:"unavailable"};}
}

export async function loadGuardTelemetryOverview():Promise<Result<OperatorTelemetryOverview>>{
  const session=await getSession();
  if(!authorizedSession(session))return {state:"forbidden"};
  const c=config();
  if(!c)return {state:"not-configured"};
  try{return {state:"ready",data:await fetchTelemetryOverview(c)};}
  catch{return {state:"unavailable"};}
}
