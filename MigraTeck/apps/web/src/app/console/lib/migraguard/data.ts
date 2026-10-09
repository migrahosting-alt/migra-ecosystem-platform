import "server-only";
import { Pool } from "pg";
import { getSession } from "../auth";
import { authorizeScope, findAlert, listAlerts, type GuardScope, type Query, type filters } from "./reader";
import { socketRead, type CommandCenter, type Coverage } from "./socket";
import type { Alert } from "./reader";
import { buildCanonicalCommandCenter } from "./canonical";
import { fetchCanonicalEvents, type CanonicalEventQuery } from "./canonical-client";
import { fetchForensicManifest, fetchIncidentDetail, fetchOperatorSnapshot, type OperatorForensicManifest, type OperatorIncidentDetail, type OperatorSnapshot } from "./operator-client";

let pool: Pool | undefined;
type Result<T> = { state:"ready"; data:T } | { state:"not-configured" | "unavailable" | "forbidden" };

async function read<T>(operation: (query: Query, scope: GuardScope) => Promise<T>): Promise<Result<T>> {
  const session = await getSession();
  const scope = authorizeScope(session,process.env.CONSOLE_ADMIN_EMAIL,process.env.MIGRAGUARD_TENANT_ID);
  if (!session || !process.env.CONSOLE_ADMIN_EMAIL || session.email.trim().toLowerCase() !== process.env.CONSOLE_ADMIN_EMAIL.trim().toLowerCase()) return {state:"forbidden"};
  if (!process.env.MIGRAGUARD_DATABASE_URL || !scope) return {state:"not-configured"};
  let client;
  try {
    pool ??= new Pool({ connectionString:process.env.MIGRAGUARD_DATABASE_URL, max:3,
      connectionTimeoutMillis:3000, statement_timeout:5000, query_timeout:6000,
      idleTimeoutMillis:10000, options:"-c default_transaction_read_only=on" });
    if (pool.listenerCount("error") === 0) pool.on("error",()=>{});
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const data = await operation((sql,values)=>client!.query(sql,values),scope);
    await client.query("COMMIT");
    return {state:"ready",data};
  } catch {
    if (client) await client.query("ROLLBACK").catch(()=>{});
    return {state:"unavailable"};
  } finally { client?.release(); }
}

async function privateFeed<T>(path:string):Promise<Result<T>> {
  const session=await getSession();
  if(!session || session.exp*1000<=Date.now() || !process.env.CONSOLE_ADMIN_EMAIL || session.email.trim().toLowerCase()!==process.env.CONSOLE_ADMIN_EMAIL.trim().toLowerCase())return {state:"forbidden"};
  try{return {state:"ready",data:await socketRead<T>(path)};}catch{return {state:"unavailable"};}
}

export const loadGuardAlerts = (input: ReturnType<typeof filters>) => process.env.MIGRAGUARD_DATABASE_URL
  && process.env.MIGRAGUARD_CONSOLE_FORCE_SOCKET !== "true"
  ? read((query,scope)=>listAlerts(query,scope,input))
  : privateFeed<{alerts:Alert[];hasNext:boolean}>(`/alerts?severity=${input.severity}&page=${input.page}`);

export const loadGuardAlert = (id: string) => process.env.MIGRAGUARD_DATABASE_URL
  && process.env.MIGRAGUARD_CONSOLE_FORCE_SOCKET !== "true"
  ? read((query,scope)=>findAlert(query,scope,id)) : privateFeed<Alert|null>(`/alerts/${id}`);

export const loadGuardCoverage = () => privateFeed<Coverage>("/status");

function normalizeIncidentSeverity(value:string){
  const lower=value.toLowerCase();
  return ["critical","high","medium","low","info"].includes(lower)?lower:"unknown";
}

function enrichCommandCenter(base:CommandCenter,snapshot:OperatorSnapshot):CommandCenter{
  let data=base;

  // An empty registered inventory must not hide observed event-producing hosts.
  // Keep the canonical view explicitly non-authoritative until inventory has records.
  if(snapshot.assets?.length){
    const evidenceByName=new Map(base.assets.rows.map(row=>[row.name,row]));
    const rows=snapshot.assets.map(asset=>{
      const name=asset.hostname||asset.assetId;
      const evidence=evidenceByName.get(name);
      return {
        name,
        state:evidence?.state||"stale" as const,
        lastEvidenceAt:evidence?.lastEvidenceAt||asset.lastScanAt,
        evidence24h:evidence?.evidence24h||0,
        edge24h:evidence?.edge24h||0,
        identity24h:evidence?.identity24h||0,
        api24h:evidence?.api24h||0,
        infrastructure24h:evidence?.infrastructure24h||0,
        secrets24h:evidence?.secrets24h||0,
        supplyChain24h:evidence?.supplyChain24h||0,
        content24h:evidence?.content24h||0,
        mail24h:evidence?.mail24h||0,
        malware24h:evidence?.malware24h||0,
        monitoring24h:evidence?.monitoring24h||0,
        inventoryId:asset.assetId,
        type:asset.type,
        ipAddress:asset.ipAddress,
        riskScore:asset.riskScore,
        lastScanAt:asset.lastScanAt,
      };
    });
    data={...data,assets:{
      total:rows.length,
      reporting:rows.filter(row=>row.state==="reporting").length,
      degraded:rows.filter(row=>row.state==="degraded").length,
      offline:rows.filter(row=>row.state==="stale").length,
      authoritative:true,
      rows,
    }};
  }

  if(snapshot.incidents){
    const active=snapshot.incidents.filter(row=>!["resolved","closed"].includes(row.status.toLowerCase()));
    data={...data,incidents:{
      connected:true,
      active:active.length,
      critical:active.filter(row=>row.severity.toLowerCase()==="critical").length,
      items:snapshot.incidents.slice(0,100).map(row=>({
        id:row.id,
        title:row.title,
        summary:[row.source,row.node].filter(Boolean).join(" · ")||"Persisted incident",
        category:row.source||"security",
        severity:normalizeIncidentSeverity(row.severity),
        status:row.status,
        riskScore:0,
        openedAt:row.createdAt,
        updatedAt:row.updatedAt,
      })),
    }};
  }

  if(snapshot.execution){
    const execution=snapshot.execution;
    data={...data,response:{
      ...data.response,
      authority:"governed",
      executorEnabled:false,
      automaticRemediation:false,
      pendingApprovals:execution.pendingApprovals,
      executed:execution.receipts.total,
      inEffect:0,
      rollbackAvailable:false,
      capabilities:execution.capabilities,
      receipts:execution.receipts,
      requests:execution.requests.map(row=>({
        id:row.executionRequestId,
        status:row.status,
        impactClass:row.impactClass,
        approvalCount:row.approvalCount,
        requiredApprovals:row.requiredApprovals,
        target:row.targetName||row.targetHostname||row.agentId,
        policy:row.policyCategory||row.playbookId,
        createdAt:row.createdAt,
        expiresAt:row.expiresAt,
      })),
    }};
  }

  if(snapshot.policyPosture){
    data={...data,policies:{
      ...data.policies,
      managed:snapshot.policyPosture.policies.length,
    }};
  }

  if(snapshot.audit){
    data={...data,audit:{
      ...data.audit,
      state:"connected",
      connected:true,
      events:snapshot.audit.slice(0,100).map(row=>({
        id:row.id,
        actorType:row.actorType,
        actorId:row.actorId,
        action:row.action,
        target:[row.targetType,row.targetId].filter(Boolean).join(" · ")||"—",
        outcome:row.outcome,
        createdAt:row.createdAt,
      })),
    }};
  }

  // Security authority matrix: connection means the dedicated bounded read model
  // answered successfully. Unavailable never means zero, healthy, or safe.
  data={...data,authorities:[
    {key:"assets",name:"Asset inventory",state:snapshot.assets?"connected":"unavailable",detail:snapshot.assets?`${snapshot.assets.length} assets loaded`:"Authority unavailable",href:"/console/migraguard/assets"},
    {key:"incidents",name:"Incident state",state:snapshot.incidents?"connected":"unavailable",detail:snapshot.incidents?`${snapshot.incidents.length} persisted incidents`:"Authority unavailable",href:"/console/migraguard/incidents"},
    {key:"execution",name:"Execution governance",state:snapshot.execution?"connected":"unavailable",detail:snapshot.execution?`${snapshot.execution.pendingApprovals} pending approvals · executor off`:"Authority unavailable",href:"/console/migraguard/response"},
    {key:"threat-intel",name:"Threat intelligence",state:snapshot.threatIntelligence?"connected":"unavailable",detail:snapshot.threatIntelligence?`${snapshot.threatIntelligence.iocs.length} IOCs · ${snapshot.threatIntelligence.threatActors.length} actors`:"Authority unavailable",href:"/console/migraguard/threats"},
    {key:"correlations",name:"Correlation engine",state:snapshot.correlations?"connected":"unavailable",detail:snapshot.correlations?`${snapshot.correlations.detections.length} detections · ${snapshot.correlations.rules.length} rules`:"Authority unavailable",href:"/console/migraguard/correlations"},
    {key:"policies",name:"Policy posture",state:snapshot.policyPosture?"connected":"unavailable",detail:snapshot.policyPosture?`${snapshot.policyPosture.policies.length} policies · mutation off`:"Authority unavailable",href:"/console/migraguard/policies"},
    {key:"compliance",name:"Compliance",state:snapshot.compliance?"connected":"unavailable",detail:snapshot.compliance?`${snapshot.compliance.assessments.length} assessments`:"Authority unavailable",href:"/console/migraguard/compliance"},
    {key:"protection",name:"Protection decisions",state:snapshot.protectionAlerts?"connected":"unavailable",detail:snapshot.protectionAlerts?`${snapshot.protectionAlerts.length} immutable decisions`:"Authority unavailable",href:"/console/migraguard/protection"},
    {key:"forensics",name:"Forensics",state:snapshot.forensics?"connected":"unavailable",detail:snapshot.forensics?`${snapshot.forensics.cases.length} cases · export off`:"Authority unavailable",href:"/console/migraguard/forensics"},
    {key:"delivery",name:"Delivery & integrations",state:snapshot.deliveryPosture?"connected":"unavailable",detail:snapshot.deliveryPosture?`${snapshot.deliveryPosture.integrations.length} integrations · outbound test off`:"Authority unavailable",href:"/console/migraguard/delivery"},
    {key:"audit",name:"Security audit",state:snapshot.audit?"connected":"unavailable",detail:snapshot.audit?`${snapshot.audit.length} audit records loaded`:"Authority unavailable",href:"/console/migraguard/audit"},
  ]};

  return data;
}

export async function loadGuardCommandCenter():Promise<Result<CommandCenter>>{
  const session=await getSession();
  if(!session||session.exp*1000<=Date.now()||!process.env.CONSOLE_ADMIN_EMAIL||session.email.trim().toLowerCase()!==process.env.CONSOLE_ADMIN_EMAIL.trim().toLowerCase())return {state:"forbidden"};
  const origin=process.env.MIGRAGUARD_API_URL,credential=process.env.MIGRAGUARD_CONSOLE_API_CREDENTIAL;
  if(!origin||!credential)return {state:"not-configured"};
  try{
    const [events,snapshot]=await Promise.all([
      fetchCanonicalEvents({origin,credential,query:{limit:100}}),
      fetchOperatorSnapshot({origin,credential}),
    ]);
    return {state:"ready",data:enrichCommandCenter(buildCanonicalCommandCenter(events),snapshot)};
  }catch{return {state:"unavailable"};}
}


export async function loadGuardOperatorSnapshot():Promise<Result<OperatorSnapshot>>{
  const session=await getSession();
  if(!session||session.exp*1000<=Date.now()||!process.env.CONSOLE_ADMIN_EMAIL||session.email.trim().toLowerCase()!==process.env.CONSOLE_ADMIN_EMAIL.trim().toLowerCase())return {state:"forbidden"};
  const origin=process.env.MIGRAGUARD_API_URL,credential=process.env.MIGRAGUARD_CONSOLE_API_CREDENTIAL;
  if(!origin||!credential)return {state:"not-configured"};
  try{return {state:"ready",data:await fetchOperatorSnapshot({origin,credential})};}catch{return {state:"unavailable"};}
}

export async function loadGuardIncidentDetail(id:string):Promise<Result<OperatorIncidentDetail>>{
  const session=await getSession();
  if(!session||session.exp*1000<=Date.now()||!process.env.CONSOLE_ADMIN_EMAIL||session.email.trim().toLowerCase()!==process.env.CONSOLE_ADMIN_EMAIL.trim().toLowerCase())return {state:"forbidden"};
  const origin=process.env.MIGRAGUARD_API_URL,credential=process.env.MIGRAGUARD_CONSOLE_API_CREDENTIAL;
  if(!origin||!credential)return {state:"not-configured"};
  try{return {state:"ready",data:await fetchIncidentDetail({origin,credential,id})};}catch{return {state:"unavailable"};}
}

export async function loadGuardForensicManifest(id:string):Promise<Result<OperatorForensicManifest>>{
  const session=await getSession();
  if(!session||session.exp*1000<=Date.now()||!process.env.CONSOLE_ADMIN_EMAIL||session.email.trim().toLowerCase()!==process.env.CONSOLE_ADMIN_EMAIL.trim().toLowerCase())return {state:"forbidden"};
  const origin=process.env.MIGRAGUARD_API_URL,credential=process.env.MIGRAGUARD_CONSOLE_API_CREDENTIAL;
  if(!origin||!credential)return {state:"not-configured"};
  try{return {state:"ready",data:await fetchForensicManifest({origin,credential,id})};}catch{return {state:"unavailable"};}
}

export async function loadCanonicalActivity(query:CanonicalEventQuery){
  const session=await getSession();
  if(!session||session.exp*1000<=Date.now()||!process.env.CONSOLE_ADMIN_EMAIL||session.email.trim().toLowerCase()!==process.env.CONSOLE_ADMIN_EMAIL.trim().toLowerCase())return {state:"forbidden"} as const;
  const origin=process.env.MIGRAGUARD_API_URL,credential=process.env.MIGRAGUARD_CONSOLE_API_CREDENTIAL;
  if(!origin||!credential)return {state:"not-configured"} as const;
  try{return {state:"ready",data:await fetchCanonicalEvents({origin,credential,query})} as const;}catch{return {state:"unavailable"} as const;}
}
