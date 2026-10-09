import type { CommandCenter } from "./socket";

export type CanonicalSecurityEvent = {
  eventId:string; timestamp:string; eventType:string; eventSource:string;
  product:string|null; service:string|null; environment:string|null; host:string|null; hostname:string|null;
  sourceIp:string|null; sourcePort:number|null; destinationIp:string|null; destinationPort:number|null;
  protocol:string|null; requestMethod:string|null; requestPath:string|null;
  processName:string|null; processPath:string|null; filePath:string|null; fileHashSha256:string|null;
  malwareFamily:string|null; detectionEngine:string|null; attackCategory:string;
  attackTechnique:string|null; severity:"info"|"low"|"medium"|"high"|"critical";
  confidence:number; actionTaken:string|null; ruleId:string|null; ruleVersion:string|null;
  firewallRule:string|null; wafRule:string|null; blocked:boolean|null; successful:boolean|null;
  observationAuthority:string; correlatedIncidentId:string|null; createdAt:string;
};

const severityRank={info:0,low:1,medium:2,high:3,critical:4} as const;
const identityCategories=new Set(["brute_force","credential_stuffing","password_spraying","suspicious_authentication","session_hijack","token_abuse","impossible_travel"]);
const edgeCategories=new Set(["waf_violation","firewall_violation","sql_injection","xss","command_injection","path_traversal","bot_activity","ddos","dos"]);
const apiCategories=new Set(["api_abuse","rate_limit_abuse"]);
const secretCategories=new Set(["secret_exposure","credential_exposure","key_exposure"]);
const supplyChainCategories=new Set(["supply_chain","dependency_risk","artifact_integrity","build_integrity"]);
const contentCategories=new Set(["malicious_upload","content_violation","unsafe_upload"]);
const mailCategories=new Set(["phishing","dns_abuse","tls_violation","mail_abuse"]);
const malwareCategories=new Set(["malware","spyware","ransomware","cryptominer","rootkit_indicator"]);

function domain(event:CanonicalSecurityEvent){
  if(identityCategories.has(event.attackCategory)||event.eventType.startsWith("auth."))return "identity";
  if(apiCategories.has(event.attackCategory)||event.eventType.startsWith("api."))return "api";
  if(secretCategories.has(event.attackCategory)||event.eventType.startsWith("secrets.")||event.eventType.startsWith("secret."))return "secrets";
  if(supplyChainCategories.has(event.attackCategory)||event.eventType.startsWith("supply_chain.")||event.eventType.startsWith("dependency.")||event.eventType.startsWith("artifact.")||event.eventType.startsWith("build."))return "supply-chain";
  if(contentCategories.has(event.attackCategory)||event.eventType.startsWith("upload.")||event.eventType.startsWith("content."))return "content";
  if(mailCategories.has(event.attackCategory)||event.eventType.startsWith("mail.")||event.eventType.startsWith("dns.")||event.eventType.startsWith("tls."))return "mail";
  if(edgeCategories.has(event.attackCategory)||event.eventType.startsWith("waf."))return "edge";
  if(malwareCategories.has(event.attackCategory)||event.eventType.startsWith("malware."))return "malware";
  if(event.eventType.startsWith("selfcheck."))return "monitoring";
  return "infrastructure";
}
function label(value:string){return value.replaceAll("_"," ").replaceAll("."," ").replace(/\b\w/g,char=>char.toUpperCase());}
function target(event:CanonicalSecurityEvent){
  return [event.product,event.service,event.host,event.requestPath].filter(Boolean).join(" · ")||"Target not reported";
}
function source(event:CanonicalSecurityEvent){return event.sourceIp||event.eventSource||"Source not reported";}
function evidence(event:CanonicalSecurityEvent){
  return [
    event.sourceIp&&`Source IP: ${event.sourceIp}`,
    event.requestMethod&&`Request method: ${event.requestMethod}`,
    event.requestPath&&`Request path: ${event.requestPath}`,
    event.processName&&`Process: ${event.processName}`,
    event.processPath&&`Process path: ${event.processPath}`,
    event.filePath&&`File path: ${event.filePath}`,
    event.fileHashSha256&&`SHA-256: ${event.fileHashSha256}`,
    event.attackTechnique&&`Technique: ${event.attackTechnique}`,
    `Classification confidence: ${event.confidence}%`,
    `Observation authority: ${event.observationAuthority}`,
  ].filter((value):value is string=>Boolean(value)).slice(0,8);
}
export function presentCanonicalEvent(event:CanonicalSecurityEvent):CommandCenter["activity"][number]{
  return {id:event.eventId,severity:event.severity,domain:domain(event),title:label(event.eventType),source:source(event),target:target(event),assetName:event.host||event.hostname||null,detection:event.ruleId||event.wafRule||event.detectionEngine||event.eventType,evidenceId:event.eventId,evidence:evidence(event),action:event.actionTaken||(event.blocked===true?"Blocked":"Observed"),state:event.blocked===true?"blocked":event.successful===true?"successful":"observed",timestamp:event.timestamp};
}

export function buildCanonicalCommandCenter(input:CanonicalSecurityEvent[],now=new Date()):CommandCenter{
  const unique=[...new Map(input.map(event=>[event.eventId,event])).values()]
    .sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
  const cutoff=now.getTime()-24*60*60*1000;
  const events=unique.filter(event=>Date.parse(event.timestamp)>=cutoff&&Date.parse(event.timestamp)<=now.getTime()+5*60*1000);
  const highest=events.reduce((rank,event)=>Math.max(rank,severityRank[event.severity]),-1);
  const overall:CommandCenter["overall"]=highest>=4
    ? {state:"critical",reason:"Critical canonical security evidence exists in the current bounded event window.",lastVerifiedAt:events[0]?.timestamp||null}
    : highest>=2
      ? {state:"elevated",reason:"Canonical security evidence requires operator review in the current bounded event window.",lastVerifiedAt:events[0]?.timestamp||null}
      : {state:"unknown",reason:events.length===0?"The canonical API is connected, but no events are present in this bounded view. This is not a claim of safety.":"Canonical evidence is available, but this bounded event view is insufficient to claim a normal ecosystem posture.",lastVerifiedAt:events[0]?.timestamp||null};

  const grouped=new Map<string,CanonicalSecurityEvent[]>();
  for(const event of events){const key=event.host||event.hostname||event.product||"Unattributed asset";grouped.set(key,[...(grouped.get(key)||[]),event]);}
  const assets=[...grouped.entries()].map(([name,rows])=>({
    name,state:"reporting" as const,lastEvidenceAt:rows[0]?.timestamp||null,evidence24h:rows.length,
    edge24h:rows.filter(event=>domain(event)==="edge").length,
    identity24h:rows.filter(event=>domain(event)==="identity").length,
    api24h:rows.filter(event=>domain(event)==="api").length,
    infrastructure24h:rows.filter(event=>domain(event)==="infrastructure").length,
    secrets24h:rows.filter(event=>domain(event)==="secrets").length,
    supplyChain24h:rows.filter(event=>domain(event)==="supply-chain").length,
    content24h:rows.filter(event=>domain(event)==="content").length,
    mail24h:rows.filter(event=>domain(event)==="mail").length,
    malware24h:rows.filter(event=>domain(event)==="malware").length,
    monitoring24h:rows.filter(event=>domain(event)==="monitoring").length,
  }));
  const countDomain=(key:string)=>events.filter(event=>domain(event)===key).length;
  const buckets=Array.from({length:12},(_,index)=>{
    const end=now.getTime()-(11-index)*2*60*60*1000,start=end-2*60*60*1000;
    const rows=events.filter(event=>{const time=Date.parse(event.timestamp);return time>start&&time<=end;});
    return {bucket:new Date(end).toISOString(),edge:rows.filter(event=>domain(event)==="edge").length,identity:rows.filter(event=>domain(event)==="identity").length,malware:rows.filter(event=>domain(event)==="malware").length,infrastructure:rows.filter(event=>domain(event)==="infrastructure").length};
  });
  const domainRows:[string,string][]=[["edge","Edge / WAF"],["identity","Identity"],["api","API"],["infrastructure","Infrastructure"],["secrets","Secrets"],["supply-chain","Supply Chain"],["content","Content & Uploads"],["mail","Mail / DNS / TLS"],["malware","Malware"],["response","Response"],["forensics","Forensics"],["monitoring","Monitoring"]];
  return {
    generatedAt:now.toISOString(),windowHours:24,overall,
    assets:{total:assets.length,reporting:assets.length,degraded:0,offline:0,authoritative:false,rows:assets},
    incidents:{connected:false,active:0,critical:0,items:[]},
    threats:{counts:{edge:countDomain("edge"),identity:countDomain("identity"),api:countDomain("api"),infrastructure:countDomain("infrastructure"),malware:countDomain("malware"),monitoring:countDomain("monitoring"),wafBlocked:events.filter(event=>event.eventType==="waf.blocked"&&event.blocked===true).length,wafDetected:events.filter(event=>event.eventType.startsWith("waf.")).length,bruteForce:events.filter(event=>event.attackCategory==="brute_force").length,malwareDetected:events.filter(event=>event.eventType==="malware.detected").length,scanFailures:events.filter(event=>event.eventType==="malware.scan_failed").length},attackSummary:{observed:events.length,blocked:events.filter(event=>event.blocked===true).length,detected:events.filter(event=>event.blocked!==true).length,brute_force:events.filter(event=>event.attackCategory==="brute_force").length,auth_compromise:events.filter(event=>event.eventType==="auth.success_after_failures").length,malware:countDomain("malware")},trend:buckets},
    activity:events.slice(0,50).map(presentCanonicalEvent),
    domains:domainRows.map(([key,name])=>{const total=countDomain(key);return {key,name,state:total>0?"active" as const:"unconnected" as const,events:total>0?total:null,detail:total>0?"Canonical evidence received in this view.":"No canonical evidence in this bounded view."};}),
    response:{automaticRemediation:false,authority:"not-connected",executorEnabled:false,pendingApprovals:0,blocked:events.filter(event=>event.blocked===true).length,queued:0,executed:0,dryRun:0,inEffect:0,rollbackAvailable:false,capabilities:{active:0,consumed:0,revoked:0,expired:0},receipts:{total:0,succeeded:0,failed:0,unknown:0,latestAt:null},requests:[],actions:[]},
    policies:{runtimeDetector:{name:"Canonical server classification",version:1,state:"active"},managed:0},
    audit:{canonicalEvents:events.length,lastEventAt:events[0]?.timestamp||null,state:"partial",connected:false,events:[]},
  };
}
