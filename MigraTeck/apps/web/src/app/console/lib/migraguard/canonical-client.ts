import type { CanonicalSecurityEvent } from "./canonical";

const allowedSeverity=new Set(["info","low","medium","high","critical"]);
const optionalString=(value:unknown)=>typeof value==="string"?value:null;
const optionalNumber=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:null;
const optionalBoolean=(value:unknown)=>typeof value==="boolean"?value:null;

export function parseCanonicalEvent(value:unknown):CanonicalSecurityEvent{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid canonical event");
  const row=value as Record<string,unknown>;
  if(typeof row.eventId!=="string"||typeof row.timestamp!=="string"||!Number.isFinite(Date.parse(row.timestamp))||typeof row.eventType!=="string"||typeof row.eventSource!=="string"||typeof row.severity!=="string"||!allowedSeverity.has(row.severity)||typeof row.attackCategory!=="string"||typeof row.confidence!=="number"||row.confidence<0||row.confidence>100||typeof row.observationAuthority!=="string"||typeof row.createdAt!=="string")throw new Error("Invalid canonical event");
  return {eventId:row.eventId,timestamp:row.timestamp,eventType:row.eventType,eventSource:row.eventSource,product:optionalString(row.product),service:optionalString(row.service),environment:optionalString(row.environment),host:optionalString(row.host),hostname:optionalString(row.hostname),sourceIp:optionalString(row.sourceIp),sourcePort:optionalNumber(row.sourcePort),destinationIp:optionalString(row.destinationIp),destinationPort:optionalNumber(row.destinationPort),protocol:optionalString(row.protocol),requestMethod:optionalString(row.requestMethod),requestPath:optionalString(row.requestPath),processName:optionalString(row.processName),processPath:optionalString(row.processPath),filePath:optionalString(row.filePath),fileHashSha256:optionalString(row.fileHashSha256),malwareFamily:optionalString(row.malwareFamily),detectionEngine:optionalString(row.detectionEngine),attackCategory:row.attackCategory,attackTechnique:optionalString(row.attackTechnique),severity:row.severity as CanonicalSecurityEvent["severity"],confidence:row.confidence,actionTaken:optionalString(row.actionTaken),ruleId:optionalString(row.ruleId),ruleVersion:optionalString(row.ruleVersion),firewallRule:optionalString(row.firewallRule),wafRule:optionalString(row.wafRule),blocked:optionalBoolean(row.blocked),successful:optionalBoolean(row.successful),observationAuthority:row.observationAuthority,correlatedIncidentId:optionalString(row.correlatedIncidentId),createdAt:row.createdAt};
}

function validatedOrigin(value:string){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash)throw new Error("Invalid MigraGuard API origin");
  const privateHttp=url.protocol==="http:"&&(url.hostname==="127.0.0.1"||url.hostname==="localhost"||url.hostname.startsWith("10.")||url.hostname.startsWith("192.168.")||url.hostname.startsWith("100."));
  if(url.protocol!=="https:"&&!privateHttp)throw new Error("MigraGuard API must use HTTPS or a private HTTP address");
  url.pathname="/v1/machine/security-events";
  return url;
}

export type CanonicalEventQuery={severity?:CanonicalSecurityEvent["severity"];eventType?:string;attackCategory?:string;before?:string;limit?:number};

export async function fetchCanonicalEvents(input:{origin:string;credential:string;query?:CanonicalEventQuery;fetcher?:typeof fetch}){
  if(!input.credential.startsWith("mgk_")||input.credential.length<20)throw new Error("Invalid MigraGuard API credential");
  const url=validatedOrigin(input.origin),query=input.query||{};
  const limit=Math.min(Math.max(query.limit||50,1),100);
  url.searchParams.set("limit",String(limit));
  if(query.severity)url.searchParams.set("severity",query.severity);
  if(query.eventType)url.searchParams.set("eventType",query.eventType);
  if(query.attackCategory)url.searchParams.set("attackCategory",query.attackCategory);
  if(query.before)url.searchParams.set("before",query.before);
  const response=await (input.fetcher||fetch)(url,{headers:{authorization:`Bearer ${input.credential}`,accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("Canonical event API unavailable");
  const text=await response.text();
  if(text.length>512*1024)throw new Error("Canonical event response too large");
  const body=JSON.parse(text) as {events?:unknown};
  if(!Array.isArray(body.events)||body.events.length>limit)throw new Error("Invalid canonical event response");
  const parsed=body.events.map(parseCanonicalEvent);
  return [...new Map(parsed.map(event=>[event.eventId,event])).values()];
}
