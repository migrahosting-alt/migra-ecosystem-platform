export type OperatorAsset = {
  assetId:string;
  type:string;
  hostname:string|null;
  ipAddress:string|null;
  riskScore:number|null;
  lastScanAt:string|null;
};


export type OperatorAssetDetail = {
  asset:{
    assetId:string;type:string;name:string;hostname:string|null;ipAddress:string|null;tags:string[];
    riskScore:number|null;lastScanAt:string|null;createdAt:string;updatedAt:string|null;
  };
  associationAuthority:"none"|"hostname_exact_not_identity";
  agents:Array<{
    agentId:string;name:string;hostname:string|null;platform:string|null;version:string|null;agentStatus:string;
    lastHeartbeatAt:string|null;enrolledAt:string|null;createdAt:string;updatedAt:string|null;
    lastAuthenticatedAt:string|null;lastEventAt:string|null;trustLastHeartbeatAt:string|null;persistedTrustState:string|null;trustUpdatedAt:string|null;
  }>;
  recentEvents:Array<{
    id:string;timestamp:string;eventType:string;eventSource:string;product:string|null;service:string|null;environment:string|null;
    host:string|null;hostname:string|null;severity:string;attackCategory:string;confidence:number|null;actionTaken:string|null;
    blocked:boolean|null;successful:boolean|null;ruleId:string|null;ruleVersion:string|null;observationAuthority:string|null;createdAt:string;
  }>;
  incidents:Array<{id:string;agentId:string|null;source:string|null;node:string|null;severity:string;status:string;title:string;createdAt:string;updatedAt:string|null;resolvedAt:string|null}>;
  mutationEnabled:false;
};

export type OperatorTelemetryOverview = {
  evaluatedAt:string;
  freshnessThresholdSeconds:number;
  agents:Array<{
    agentId:string;name:string;hostname:string|null;ipAddress:string|null;platform:string|null;version:string|null;agentStatus:string;
    agentLastHeartbeatAt:string|null;enrolledAt:string|null;createdAt:string;agentUpdatedAt:string|null;
    lastAuthenticatedAt:string|null;lastEventAt:string|null;trustLastHeartbeatAt:string|null;persistedTrustState:string|null;trustUpdatedAt:string|null;
    evidenceState:"current"|"stale"|"unknown";
  }>;
  mutationEnabled:false;
};

export type OperatorIncident = {
  id:string;
  agentId:string|null;
  source:string|null;
  node:string|null;
  severity:string;
  status:string;
  title:string;
  createdAt:string;
  updatedAt:string|null;
};

export type OperatorAuditEvent = {
  id:string;
  actorType:string;
  actorId:string|null;
  action:string;
  targetType:string|null;
  targetId:string|null;
  outcome:string;
  createdAt:string;
};

export type OperatorExecutionAuthority = {
  authority:"governed";
  automaticRemediation:false;
  executorEnabled:false;
  pendingApprovals:number;
  requests:Array<{
    executionRequestId:string;
    playbookId:string;
    agentId:string;
    status:string;
    impactClass:string;
    requiredApprovals:number;
    approvalCount:number;
    targetName:string|null;
    targetHostname:string|null;
    policyCategory:string|null;
    createdAt:string;
    expiresAt:string;
  }>;
  capabilities:{active:number;consumed:number;revoked:number;expired:number};
  receipts:{total:number;succeeded:number;failed:number;unknown:number;latestAt:string|null};
};

export type OperatorThreatIntelligence = {
  iocs:Array<{
    id:string;type:string;value:string;threatType:string|null;confidence:number|null;source:string|null;
    firstSeenAt:string|null;lastSeenAt:string|null;autoDistribute:boolean;createdAt:string;
  }>;
  threatActors:Array<{
    id:string;name:string;aliases:string[];sophistication:string|null;firstSeenAt:string|null;
    lastActivityAt:string|null;createdAt:string;
  }>;
};

export type OperatorCorrelations = {
  rules:Array<{
    id:string;name:string;description:string|null;enabled:boolean;timeWindowMinutes:number;
    severity:string;createdAt:string;updatedAt:string|null;
  }>;
  detections:Array<{
    id:string;ruleId:string;ruleName:string;severity:string;description:string|null;
    eventCount:number;detectedAt:string;incidentId:string|null;
  }>;
};

export type OperatorCompliance = {
  frameworks:Array<{id:string;name:string;description:string|null;version:string|null;controlCount:number}>;
  assessments:Array<{
    id:string;frameworkId:string;frameworkName:string;frameworkVersion:string|null;status:string;
    score:number|null;assessedAt:string|null;createdAt:string;updatedAt:string|null;
  }>;
};

export type OperatorPolicyPosture = {
  policies:Array<{
    id:string;name:string;description:string|null;type:string;enabled:boolean;priority:number;
    lastTriggeredAt:string|null;createdAt:string;updatedAt:string|null;
  }>;
  workflows:Array<{
    id:string;name:string;description:string|null;enabled:boolean;createdAt:string;updatedAt:string|null;
  }>;
  playbooks:Array<{
    id:string;name:string;slug:string;description:string|null;category:string|null;version:number;
    requiresApproval:boolean;systemDefined:boolean;
  }>;
  workflowExecutions:{total:number;running:number;completed:number;failed:number;latestAt:string|null};
  mutationEnabled:false;
};

export type OperatorForensics = {
  cases:Array<{
    incidentId:string;title:string;severity:string;status:string;createdAt:string;updatedAt:string|null;
    linkedEventCount:number;noteCount:number;latestEvidenceAt:string|null;latestNoteAt:string|null;
  }>;
  immutableExportEnabled:false;
  chainOfCustodyExportEnabled:false;
};


export type OperatorProtectionAlert = {
  id:string;evidenceId:string;agentId:string;detectorId:string;policyVersion:number;severity:string;title:string;createdAt:string;
  eventType:string;attackCategory:string;host:string|null;hostname:string|null;correlatedIncidentId:string|null;
  executionRequestId:string|null;responseStatus:string|null;impactClass:string|null;requiredApprovals:number;approvalCount:number;
};

export type OperatorIncidentDetail = {
  incident:{
    id:string;agentId:string|null;source:string|null;node:string|null;severity:string;status:string;title:string;
    description:string|null;hypothesis:string|null;assignedTo:string|null;resolvedAt:string|null;resolvedBy:string|null;
    createdAt:string;updatedAt:string|null;
  };
  events:Array<{
    id:string;timestamp:string;eventType:string;eventSource:string;host:string|null;hostname:string|null;severity:string;
    attackCategory:string;confidence:number|null;actionTaken:string|null;blocked:boolean|null;successful:boolean|null;ruleId:string|null;
  }>;
  correlations:Array<{id:string;ruleId:string;ruleName:string;severity:string;description:string|null;eventCount:number;detectedAt:string}>;
  protectionAlerts:Array<{
    id:string;evidenceId:string;agentId:string;detectorId:string;policyVersion:number;severity:string;title:string;createdAt:string;
    executionRequestId:string|null;responseStatus:string|null;impactClass:string|null;requiredApprovals:number;approvalCount:number;
  }>;
};



export type OperatorForensicManifest = {
  schemaVersion:1;
  generatedAt:string;
  integrityModel:"live-row-sha256";
  manifestSha256:string;
  signed:false;
  immutable:false;
  chainOfCustodyQualified:false;
  exportEnabled:false;
  incident:{
    id:string;agentId:string|null;source:string|null;node:string|null;severity:string;status:string;title:string;
    createdAt:string;updatedAt:string|null;resolvedAt:string|null;
  };
  events:Array<{
    id:string;timestamp:string;eventType:string;eventSource:string;product:string|null;service:string|null;environment:string|null;
    host:string|null;hostname:string|null;sourceIp:string|null;destinationIp:string|null;protocol:string|null;requestMethod:string|null;requestPath:string|null;
    processName:string|null;processPath:string|null;filePath:string|null;fileHashSha256:string|null;malwareFamily:string|null;detectionEngine:string|null;
    attackCategory:string;attackTechnique:string|null;severity:string;confidence:number|null;actionTaken:string|null;ruleId:string|null;ruleVersion:string|null;
    blocked:boolean|null;successful:boolean|null;observationAuthority:string|null;createdAt:string;
  }>;
  correlations:Array<{id:string;ruleId:string;ruleName:string;severity:string;description:string|null;eventCount:number;detectedAt:string}>;
  protectionAlerts:Array<{
    id:string;evidenceId:string;agentId:string;detectorId:string;policyVersion:number;severity:string;title:string;createdAt:string;
    executionRequestId:string|null;responseStatus:string|null;impactClass:string|null;requiredApprovals:number;approvalCount:number;
  }>;
};

export type OperatorDeliveryPosture = {
  integrations:Array<{
    id:string;name:string;type:string;enabled:boolean;lastSyncAt:string|null;lastTestedAt:string|null;
    lastTestStatus:string|null;lastTestError:string|null;createdAt:string;updatedAt:string|null;
  }>;
  notificationChannels:Array<{
    id:string;type:string;name:string;enabled:boolean;createdAt:string;updatedAt:string|null;
  }>;
  notifications:{
    total:number;pending:number;sent:number;failed:number;read:number;critical:number;high:number;latestSentAt:string|null;latestCreatedAt:string|null;
  };
  mutationEnabled:false;
  outboundTestEnabled:false;
};

export type OperatorSnapshot = {
  assets:OperatorAsset[]|null;
  incidents:OperatorIncident[]|null;
  audit:OperatorAuditEvent[]|null;
  execution:OperatorExecutionAuthority|null;
  threatIntelligence:OperatorThreatIntelligence|null;
  correlations:OperatorCorrelations|null;
  compliance:OperatorCompliance|null;
  policyPosture:OperatorPolicyPosture|null;
  forensics:OperatorForensics|null;
  protectionAlerts:OperatorProtectionAlert[]|null;
  deliveryPosture:OperatorDeliveryPosture|null;
};

const stringOrNull=(value:unknown)=>typeof value==="string"&&value.length<=500?value:null;
const textOrNull=(value:unknown)=>typeof value==="string"&&value.length<=4000?value:null;
const finiteOrNull=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:null;
const integer=(value:unknown)=>typeof value==="number"&&Number.isInteger(value)&&value>=0?value:0;
const safeIso=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const bool=(value:unknown)=>value===true;
const strings=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==="string").slice(0,50).map(item=>item.slice(0,200)):[];
function object(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

function originFor(input:string,path:string){
  const url=new URL(input);
  if(url.username||url.password||url.search||url.hash)throw new Error("Invalid MigraGuard API origin");
  const privateHttp=url.protocol==="http:"&&(url.hostname==="127.0.0.1"||url.hostname==="localhost"||url.hostname.startsWith("10.")||url.hostname.startsWith("192.168.")||url.hostname.startsWith("100."));
  if(url.protocol!=="https:"&&!privateHttp)throw new Error("MigraGuard API must use HTTPS or a private HTTP address");
  url.pathname=path;
  return url;
}

async function readJson(input:{origin:string;credential:string;path:string;fetcher?:typeof fetch}){
  if(!input.credential.startsWith("mgk_")||input.credential.length<20)throw new Error("Invalid MigraGuard API credential");
  const response=await (input.fetcher||fetch)(originFor(input.origin,input.path),{headers:{authorization:`Bearer ${input.credential}`,accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("MigraGuard operator API unavailable");
  const text=await response.text();
  if(text.length>512*1024)throw new Error("MigraGuard operator response too large");
  return JSON.parse(text) as unknown;
}

export async function fetchOperatorAssets(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorAsset[]>{
  const body=object(await readJson({...input,path:"/v1/machine/assets"}));
  if(!Array.isArray(body.assets)||body.assets.length>500)throw new Error("Invalid asset response");
  return body.assets.map((value)=>{
    const row=object(value),assetId=stringOrNull(row.asset_id),type=stringOrNull(row.type);
    if(!assetId||!type)throw new Error("Invalid asset row");
    return {assetId,type,hostname:stringOrNull(row.hostname),ipAddress:stringOrNull(row.ip_address),riskScore:finiteOrNull(row.risk_score),lastScanAt:safeIso(row.last_scan_at)};
  });
}

export async function fetchAssetDetail(
  input:{origin:string;credential:string;id:string;fetcher?:typeof fetch}
):Promise<OperatorAssetDetail>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id))throw new Error("Invalid asset id");
  const body=object(await readJson({...input,path:"/v1/machine/assets/"+input.id}));
  if(body.mutationEnabled!==false)throw new Error("Invalid asset detail authority");
  if(body.associationAuthority!=="none"&&body.associationAuthority!=="hostname_exact_not_identity")throw new Error("Invalid asset association authority");
  const asset=object(body.asset),assetId=stringOrNull(asset.asset_id),type=stringOrNull(asset.type),name=stringOrNull(asset.name),createdAt=safeIso(asset.created_at);
  if(!assetId||!type||!name||!createdAt)throw new Error("Invalid asset detail");
  if(!Array.isArray(body.agents)||body.agents.length>20||!Array.isArray(body.recentEvents)||body.recentEvents.length>100||!Array.isArray(body.incidents)||body.incidents.length>100)throw new Error("Invalid asset detail collections");

  const agents=body.agents.map(value=>{
    const row=object(value),agentId=stringOrNull(row.agent_id),agentName=stringOrNull(row.name),agentStatus=stringOrNull(row.agent_status),agentCreatedAt=safeIso(row.created_at);
    if(!agentId||!agentName||!agentStatus||!agentCreatedAt)throw new Error("Invalid asset agent");
    return {agentId,name:agentName,hostname:stringOrNull(row.hostname),platform:stringOrNull(row.platform),version:stringOrNull(row.version),agentStatus,lastHeartbeatAt:safeIso(row.last_heartbeat_at),enrolledAt:safeIso(row.enrolled_at),createdAt:agentCreatedAt,updatedAt:safeIso(row.updated_at),lastAuthenticatedAt:safeIso(row.last_authenticated_at),lastEventAt:safeIso(row.last_event_at),trustLastHeartbeatAt:safeIso(row.trust_last_heartbeat_at),persistedTrustState:stringOrNull(row.persisted_trust_state),trustUpdatedAt:safeIso(row.trust_updated_at)};
  });

  const recentEvents=body.recentEvents.map(value=>{
    const row=object(value),id=stringOrNull(row.ingest_id),timestamp=safeIso(row.event_timestamp),eventType=stringOrNull(row.event_type),eventSource=stringOrNull(row.event_source),severity=stringOrNull(row.severity),attackCategory=stringOrNull(row.attack_category),eventCreatedAt=safeIso(row.created_at);
    if(!id||!timestamp||!eventType||!eventSource||!severity||!attackCategory||!eventCreatedAt)throw new Error("Invalid asset event");
    return {id,timestamp,eventType,eventSource,product:stringOrNull(row.product),service:stringOrNull(row.service),environment:stringOrNull(row.environment),host:stringOrNull(row.host),hostname:stringOrNull(row.hostname),severity,attackCategory,confidence:finiteOrNull(row.confidence),actionTaken:stringOrNull(row.action_taken),blocked:typeof row.blocked==="boolean"?row.blocked:null,successful:typeof row.successful==="boolean"?row.successful:null,ruleId:stringOrNull(row.rule_id),ruleVersion:stringOrNull(row.rule_version),observationAuthority:stringOrNull(row.observation_authority),createdAt:eventCreatedAt};
  });

  const incidents=body.incidents.map(value=>{
    const row=object(value),id=stringOrNull(row.id),severity=stringOrNull(row.severity),status=stringOrNull(row.status),title=stringOrNull(row.title),incidentCreatedAt=safeIso(row.created_at);
    if(!id||!severity||!status||!title||!incidentCreatedAt)throw new Error("Invalid asset incident");
    return {id,agentId:stringOrNull(row.agent_id),source:stringOrNull(row.source),node:stringOrNull(row.node),severity,status,title,createdAt:incidentCreatedAt,updatedAt:safeIso(row.updated_at),resolvedAt:safeIso(row.resolved_at)};
  });

  return {
    asset:{assetId,type,name,hostname:stringOrNull(asset.hostname),ipAddress:stringOrNull(asset.ip_address),tags:strings(asset.tags),riskScore:finiteOrNull(asset.risk_score),lastScanAt:safeIso(asset.last_scan_at),createdAt,updatedAt:safeIso(asset.updated_at)},
    associationAuthority:body.associationAuthority,agents,recentEvents,incidents,mutationEnabled:false,
  };
}

export async function fetchTelemetryOverview(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorTelemetryOverview>{
  const body=object(await readJson({...input,path:"/v1/machine/telemetry"}));
  if(body.mutationEnabled!==false||!Array.isArray(body.agents)||body.agents.length>500)throw new Error("Invalid telemetry overview authority");
  const evaluatedAt=safeIso(body.evaluatedAt),freshnessThresholdSeconds=integer(body.freshnessThresholdSeconds);
  if(!evaluatedAt||freshnessThresholdSeconds<1)throw new Error("Invalid telemetry overview timing");
  const agents=body.agents.map(value=>{
    const row=object(value),agentId=stringOrNull(row.agent_id),name=stringOrNull(row.name),agentStatus=stringOrNull(row.agent_status),createdAt=safeIso(row.created_at),evidenceState=stringOrNull(row.evidence_state);
    if(!agentId||!name||!agentStatus||!createdAt||!evidenceState||!["current","stale","unknown"].includes(evidenceState))throw new Error("Invalid telemetry agent");
    return {agentId,name,hostname:stringOrNull(row.hostname),ipAddress:stringOrNull(row.ip_address),platform:stringOrNull(row.platform),version:stringOrNull(row.version),agentStatus,agentLastHeartbeatAt:safeIso(row.agent_last_heartbeat_at),enrolledAt:safeIso(row.enrolled_at),createdAt,agentUpdatedAt:safeIso(row.agent_updated_at),lastAuthenticatedAt:safeIso(row.last_authenticated_at),lastEventAt:safeIso(row.last_event_at),trustLastHeartbeatAt:safeIso(row.trust_last_heartbeat_at),persistedTrustState:stringOrNull(row.persisted_trust_state),trustUpdatedAt:safeIso(row.trust_updated_at),evidenceState:evidenceState as "current"|"stale"|"unknown"};
  });
  return {evaluatedAt,freshnessThresholdSeconds,agents,mutationEnabled:false};
}

export async function fetchOperatorIncidents(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorIncident[]>{
  const body=object(await readJson({...input,path:"/v1/machine/incidents"}));
  if(!Array.isArray(body.incidents)||body.incidents.length>500)throw new Error("Invalid incident response");
  return body.incidents.map((value)=>{
    const row=object(value),id=stringOrNull(row.id),severity=stringOrNull(row.severity),status=stringOrNull(row.status),title=stringOrNull(row.title),createdAt=safeIso(row.created_at);
    if(!id||!severity||!status||!title||!createdAt)throw new Error("Invalid incident row");
    return {id,agentId:stringOrNull(row.agent_id),source:stringOrNull(row.source),node:stringOrNull(row.node),severity,status,title,createdAt,updatedAt:safeIso(row.updated_at)};
  });
}

export async function fetchOperatorAudit(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorAuditEvent[]>{
  const body=object(await readJson({...input,path:"/v1/machine/audit"}));
  if(!Array.isArray(body.audit)||body.audit.length>500)throw new Error("Invalid audit response");
  return body.audit.map((value)=>{
    const row=object(value),id=stringOrNull(row.security_audit_event_id),actorType=stringOrNull(row.actor_type),action=stringOrNull(row.action),outcome=stringOrNull(row.outcome),createdAt=safeIso(row.created_at);
    if(!id||!actorType||!action||!outcome||!createdAt)throw new Error("Invalid audit row");
    return {id,actorType,actorId:stringOrNull(row.actor_id),action,targetType:stringOrNull(row.target_type),targetId:stringOrNull(row.target_id),outcome,createdAt};
  });
}

export async function fetchExecutionAuthority(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorExecutionAuthority>{
  const body=object(await readJson({...input,path:"/v1/machine/execution-authority"}));
  if(body.authority!=="governed"||body.automaticRemediation!==false||body.executorEnabled!==false||!Array.isArray(body.requests)||body.requests.length>100)throw new Error("Invalid execution authority response");
  const requests=body.requests.map((value)=>{
    const row=object(value),target=object(row.targetSnapshot),policy=object(row.policySnapshot);
    const executionRequestId=stringOrNull(row.executionRequestId),playbookId=stringOrNull(row.playbookId),agentId=stringOrNull(row.agentId),status=stringOrNull(row.status),impactClass=stringOrNull(row.impactClass),createdAt=safeIso(row.createdAt),expiresAt=safeIso(row.expiresAt);
    if(!executionRequestId||!playbookId||!agentId||!status||!impactClass||!createdAt||!expiresAt)throw new Error("Invalid execution request row");
    return {executionRequestId,playbookId,agentId,status,impactClass,requiredApprovals:integer(row.requiredApprovals),approvalCount:integer(row.approvalCount),targetName:stringOrNull(target.name),targetHostname:stringOrNull(target.hostname),policyCategory:stringOrNull(policy.category),createdAt,expiresAt};
  });
  const capabilities=object(body.capabilities),receipts=object(body.receipts);
  return {
    authority:"governed",automaticRemediation:false,executorEnabled:false,pendingApprovals:integer(body.pendingApprovals),requests,
    capabilities:{active:integer(capabilities.active),consumed:integer(capabilities.consumed),revoked:integer(capabilities.revoked),expired:integer(capabilities.expired)},
    receipts:{total:integer(receipts.total),succeeded:integer(receipts.succeeded),failed:integer(receipts.failed),unknown:integer(receipts.unknown),latestAt:safeIso(receipts.latestAt)},
  };
}

export async function fetchThreatIntelligence(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorThreatIntelligence>{
  const body=object(await readJson({...input,path:"/v1/machine/threat-intelligence"}));
  if(!Array.isArray(body.iocs)||body.iocs.length>250||!Array.isArray(body.threatActors)||body.threatActors.length>100)throw new Error("Invalid threat intelligence response");
  const iocs=body.iocs.map(value=>{
    const row=object(value),id=stringOrNull(row.ioc_id),type=stringOrNull(row.type),iocValue=stringOrNull(row.value),createdAt=safeIso(row.created_at);
    if(!id||!type||!iocValue||!createdAt)throw new Error("Invalid IOC row");
    return {id,type,value:iocValue,threatType:stringOrNull(row.threat_type),confidence:finiteOrNull(row.confidence),source:stringOrNull(row.source),firstSeenAt:safeIso(row.first_seen_at),lastSeenAt:safeIso(row.last_seen_at),autoDistribute:bool(row.auto_distribute),createdAt};
  });
  const threatActors=body.threatActors.map(value=>{
    const row=object(value),id=stringOrNull(row.actor_id),name=stringOrNull(row.name),createdAt=safeIso(row.created_at);
    if(!id||!name||!createdAt)throw new Error("Invalid threat actor row");
    return {id,name,aliases:strings(row.aliases),sophistication:stringOrNull(row.sophistication),firstSeenAt:safeIso(row.first_seen_at),lastActivityAt:safeIso(row.last_activity_at),createdAt};
  });
  return {iocs,threatActors};
}

export async function fetchCorrelations(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorCorrelations>{
  const body=object(await readJson({...input,path:"/v1/machine/correlations"}));
  if(!Array.isArray(body.rules)||body.rules.length>200||!Array.isArray(body.detections)||body.detections.length>250)throw new Error("Invalid correlation response");
  const rules=body.rules.map(value=>{
    const row=object(value),id=stringOrNull(row.rule_id),name=stringOrNull(row.name),severity=stringOrNull(row.severity),createdAt=safeIso(row.created_at);
    if(!id||!name||!severity||!createdAt)throw new Error("Invalid correlation rule");
    return {id,name,description:stringOrNull(row.description),enabled:bool(row.enabled),timeWindowMinutes:integer(row.time_window_minutes),severity,createdAt,updatedAt:safeIso(row.updated_at)};
  });
  const detections=body.detections.map(value=>{
    const row=object(value),id=stringOrNull(row.correlation_id),ruleId=stringOrNull(row.rule_id),ruleName=stringOrNull(row.rule_name),severity=stringOrNull(row.severity),detectedAt=safeIso(row.detected_at);
    if(!id||!ruleId||!ruleName||!severity||!detectedAt)throw new Error("Invalid correlation detection");
    return {id,ruleId,ruleName,severity,description:stringOrNull(row.description),eventCount:integer(row.event_count),detectedAt,incidentId:stringOrNull(row.incident_id)};
  });
  return {rules,detections};
}

export async function fetchCompliance(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorCompliance>{
  const body=object(await readJson({...input,path:"/v1/machine/compliance"}));
  if(!Array.isArray(body.frameworks)||body.frameworks.length>100||!Array.isArray(body.assessments)||body.assessments.length>200)throw new Error("Invalid compliance response");
  const frameworks=body.frameworks.map(value=>{
    const row=object(value),id=stringOrNull(row.framework_id),name=stringOrNull(row.name);
    if(!id||!name)throw new Error("Invalid compliance framework");
    return {id,name,description:stringOrNull(row.description),version:stringOrNull(row.version),controlCount:integer(row.control_count)};
  });
  const assessments=body.assessments.map(value=>{
    const row=object(value),id=stringOrNull(row.assessment_id),frameworkId=stringOrNull(row.framework_id),frameworkName=stringOrNull(row.framework_name),status=stringOrNull(row.status),createdAt=safeIso(row.created_at);
    if(!id||!frameworkId||!frameworkName||!status||!createdAt)throw new Error("Invalid compliance assessment");
    return {id,frameworkId,frameworkName,frameworkVersion:stringOrNull(row.framework_version),status,score:finiteOrNull(row.score),assessedAt:safeIso(row.assessed_at),createdAt,updatedAt:safeIso(row.updated_at)};
  });
  return {frameworks,assessments};
}

export async function fetchPolicyPosture(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorPolicyPosture>{
  const body=object(await readJson({...input,path:"/v1/machine/policy-posture"}));
  const playbookRows=body.playbooks===undefined?[]:body.playbooks;
  if(body.mutationEnabled!==false||!Array.isArray(body.policies)||body.policies.length>250||!Array.isArray(body.workflows)||body.workflows.length>200||!Array.isArray(playbookRows)||playbookRows.length>200)throw new Error("Invalid policy posture response");
  const policies=body.policies.map(value=>{
    const row=object(value),id=stringOrNull(row.policy_id),name=stringOrNull(row.name),type=stringOrNull(row.type),createdAt=safeIso(row.created_at);
    if(!id||!name||!type||!createdAt)throw new Error("Invalid policy row");
    return {id,name,description:stringOrNull(row.description),type,enabled:bool(row.enabled),priority:integer(row.priority),lastTriggeredAt:safeIso(row.last_triggered_at),createdAt,updatedAt:safeIso(row.updated_at)};
  });
  const workflows=body.workflows.map(value=>{
    const row=object(value),id=stringOrNull(row.workflow_id),name=stringOrNull(row.name),createdAt=safeIso(row.created_at);
    if(!id||!name||!createdAt)throw new Error("Invalid workflow row");
    return {id,name,description:stringOrNull(row.description),enabled:bool(row.enabled),createdAt,updatedAt:safeIso(row.updated_at)};
  });
  const playbooks=playbookRows.map(value=>{
    const row=object(value),id=stringOrNull(row.id),name=stringOrNull(row.name),slug=stringOrNull(row.slug);
    if(!id||!name||!slug)throw new Error("Invalid response playbook row");
    return {id,name,slug,description:stringOrNull(row.description),category:stringOrNull(row.category),version:integer(row.version),requiresApproval:bool(row.requires_approval),systemDefined:bool(row.system_defined)};
  });
  const summary=object(body.workflowExecutions);
  return {policies,workflows,playbooks,workflowExecutions:{total:integer(summary.total),running:integer(summary.running),completed:integer(summary.completed),failed:integer(summary.failed),latestAt:safeIso(summary.latestAt)},mutationEnabled:false};
}

export async function fetchForensics(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorForensics>{
  const body=object(await readJson({...input,path:"/v1/machine/forensics"}));
  if(body.immutableExportEnabled!==false||body.chainOfCustodyExportEnabled!==false||!Array.isArray(body.cases)||body.cases.length>200)throw new Error("Invalid forensic response");
  const cases=body.cases.map(value=>{
    const row=object(value),incidentId=stringOrNull(row.incident_id),title=stringOrNull(row.title),severity=stringOrNull(row.severity),status=stringOrNull(row.status),createdAt=safeIso(row.created_at);
    if(!incidentId||!title||!severity||!status||!createdAt)throw new Error("Invalid forensic case row");
    return {incidentId,title,severity,status,createdAt,updatedAt:safeIso(row.updated_at),linkedEventCount:integer(row.linked_event_count),noteCount:integer(row.note_count),latestEvidenceAt:safeIso(row.latest_evidence_at),latestNoteAt:safeIso(row.latest_note_at)};
  });
  return {cases,immutableExportEnabled:false,chainOfCustodyExportEnabled:false};
}

export async function fetchProtectionAlerts(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorProtectionAlert[]>{
  const body=object(await readJson({...input,path:"/v1/machine/protection-alerts"}));
  if(!Array.isArray(body.alerts)||body.alerts.length>250)throw new Error("Invalid protection alert response");
  return body.alerts.map(value=>{
    const row=object(value);
    const id=stringOrNull(row.alert_id),evidenceId=stringOrNull(row.evidence_id),agentId=stringOrNull(row.agent_id);
    const detectorId=stringOrNull(row.detector_id),severity=stringOrNull(row.severity),title=stringOrNull(row.title),createdAt=safeIso(row.created_at);
    const eventType=stringOrNull(row.event_type),attackCategory=stringOrNull(row.attack_category);
    if(!id||!evidenceId||!agentId||!detectorId||!severity||!title||!createdAt||!eventType||!attackCategory)throw new Error("Invalid protection alert row");
    return {
      id,evidenceId,agentId,detectorId,policyVersion:integer(row.policy_version),severity,title,createdAt,eventType,attackCategory,
      host:stringOrNull(row.host),hostname:stringOrNull(row.hostname),correlatedIncidentId:stringOrNull(row.correlated_incident_id),
      executionRequestId:stringOrNull(row.execution_request_id),responseStatus:stringOrNull(row.response_status),impactClass:stringOrNull(row.impact_class),
      requiredApprovals:integer(row.required_approvals),approvalCount:integer(row.approval_count),
    };
  });
}

export async function fetchIncidentDetail(
  input:{origin:string;credential:string;id:string;fetcher?:typeof fetch}
):Promise<OperatorIncidentDetail>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id))throw new Error("Invalid incident id");
  const body=object(await readJson({...input,path:"/v1/machine/incidents/"+input.id}));
  const incident=object(body.incident);
  const id=stringOrNull(incident.id),severity=stringOrNull(incident.severity),status=stringOrNull(incident.status),title=stringOrNull(incident.title),createdAt=safeIso(incident.created_at);
  if(!id||!severity||!status||!title||!createdAt)throw new Error("Invalid incident detail");
  if(!Array.isArray(body.events)||body.events.length>250||!Array.isArray(body.correlations)||body.correlations.length>100||!Array.isArray(body.protectionAlerts)||body.protectionAlerts.length>100)throw new Error("Invalid incident detail collections");

  const events=body.events.map(value=>{
    const row=object(value),eventId=stringOrNull(row.ingest_id),timestamp=safeIso(row.event_timestamp),eventType=stringOrNull(row.event_type),eventSource=stringOrNull(row.event_source),eventSeverity=stringOrNull(row.severity),attackCategory=stringOrNull(row.attack_category);
    if(!eventId||!timestamp||!eventType||!eventSource||!eventSeverity||!attackCategory)throw new Error("Invalid incident event");
    return {
      id:eventId,timestamp,eventType,eventSource,host:stringOrNull(row.host),hostname:stringOrNull(row.hostname),severity:eventSeverity,attackCategory,
      confidence:finiteOrNull(row.confidence),actionTaken:stringOrNull(row.action_taken),
      blocked:typeof row.blocked==="boolean"?row.blocked:null,successful:typeof row.successful==="boolean"?row.successful:null,ruleId:stringOrNull(row.rule_id),
    };
  });

  const correlations=body.correlations.map(value=>{
    const row=object(value),correlationId=stringOrNull(row.correlation_id),ruleId=stringOrNull(row.rule_id),ruleName=stringOrNull(row.rule_name),correlationSeverity=stringOrNull(row.severity),detectedAt=safeIso(row.detected_at);
    if(!correlationId||!ruleId||!ruleName||!correlationSeverity||!detectedAt)throw new Error("Invalid incident correlation");
    return {id:correlationId,ruleId,ruleName,severity:correlationSeverity,description:textOrNull(row.description),eventCount:integer(row.event_count),detectedAt};
  });

  const protectionAlerts=body.protectionAlerts.map(value=>{
    const row=object(value),alertId=stringOrNull(row.alert_id),evidenceId=stringOrNull(row.evidence_id),agentId=stringOrNull(row.agent_id),detectorId=stringOrNull(row.detector_id),alertSeverity=stringOrNull(row.severity),alertTitle=stringOrNull(row.title),alertCreatedAt=safeIso(row.created_at);
    if(!alertId||!evidenceId||!agentId||!detectorId||!alertSeverity||!alertTitle||!alertCreatedAt)throw new Error("Invalid incident protection alert");
    return {
      id:alertId,evidenceId,agentId,detectorId,policyVersion:integer(row.policy_version),severity:alertSeverity,title:alertTitle,createdAt:alertCreatedAt,
      executionRequestId:stringOrNull(row.execution_request_id),responseStatus:stringOrNull(row.response_status),impactClass:stringOrNull(row.impact_class),
      requiredApprovals:integer(row.required_approvals),approvalCount:integer(row.approval_count),
    };
  });

  return {
    incident:{
      id,agentId:stringOrNull(incident.agent_id),source:stringOrNull(incident.source),node:stringOrNull(incident.node),severity,status,title,
      description:textOrNull(incident.description),hypothesis:textOrNull(incident.hypothesis),assignedTo:stringOrNull(incident.assigned_to),
      resolvedAt:safeIso(incident.resolved_at),resolvedBy:stringOrNull(incident.resolved_by),createdAt,updatedAt:safeIso(incident.updated_at),
    },
    events,correlations,protectionAlerts,
  };
}

export async function fetchForensicManifest(
  input:{origin:string;credential:string;id:string;fetcher?:typeof fetch}
):Promise<OperatorForensicManifest>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id))throw new Error("Invalid incident id");
  const body=object(await readJson({...input,path:"/v1/machine/forensics/incidents/"+input.id+"/manifest"}));
  if(body.schemaVersion!==1||body.integrityModel!=="live-row-sha256"||body.signed!==false||body.immutable!==false||body.chainOfCustodyQualified!==false||body.exportEnabled!==false)throw new Error("Invalid forensic manifest authority");
  const generatedAt=safeIso(body.generatedAt),manifestSha256=stringOrNull(body.manifestSha256);
  if(!generatedAt||!manifestSha256||!/^[0-9a-f]{64}$/.test(manifestSha256))throw new Error("Invalid forensic manifest fingerprint");

  const incident=object(body.incident);
  const incidentId=stringOrNull(incident.id),incidentSeverity=stringOrNull(incident.severity),incidentStatus=stringOrNull(incident.status),incidentTitle=stringOrNull(incident.title),incidentCreatedAt=safeIso(incident.created_at);
  if(!incidentId||!incidentSeverity||!incidentStatus||!incidentTitle||!incidentCreatedAt)throw new Error("Invalid forensic incident");

  if(!Array.isArray(body.events)||body.events.length>500||!Array.isArray(body.correlations)||body.correlations.length>200||!Array.isArray(body.protectionAlerts)||body.protectionAlerts.length>200)throw new Error("Invalid forensic manifest collections");

  const events=body.events.map(value=>{
    const row=object(value),id=stringOrNull(row.id),timestamp=safeIso(row.timestamp),eventType=stringOrNull(row.event_type),eventSource=stringOrNull(row.event_source),severity=stringOrNull(row.severity),attackCategory=stringOrNull(row.attack_category),createdAt=safeIso(row.created_at);
    if(!id||!timestamp||!eventType||!eventSource||!severity||!attackCategory||!createdAt)throw new Error("Invalid forensic event");
    return {
      id,timestamp,eventType,eventSource,product:stringOrNull(row.product),service:stringOrNull(row.service),environment:stringOrNull(row.environment),host:stringOrNull(row.host),hostname:stringOrNull(row.hostname),
      sourceIp:stringOrNull(row.source_ip),destinationIp:stringOrNull(row.destination_ip),protocol:stringOrNull(row.protocol),requestMethod:stringOrNull(row.request_method),requestPath:textOrNull(row.request_path),
      processName:stringOrNull(row.process_name),processPath:textOrNull(row.process_path),filePath:textOrNull(row.file_path),fileHashSha256:stringOrNull(row.file_hash_sha256),malwareFamily:stringOrNull(row.malware_family),detectionEngine:stringOrNull(row.detection_engine),
      attackCategory,attackTechnique:stringOrNull(row.attack_technique),severity,confidence:finiteOrNull(row.confidence),actionTaken:stringOrNull(row.action_taken),ruleId:stringOrNull(row.rule_id),ruleVersion:stringOrNull(row.rule_version),
      blocked:typeof row.blocked==="boolean"?row.blocked:null,successful:typeof row.successful==="boolean"?row.successful:null,observationAuthority:stringOrNull(row.observation_authority),createdAt,
    };
  });

  const correlations=body.correlations.map(value=>{
    const row=object(value),id=stringOrNull(row.id),ruleId=stringOrNull(row.rule_id),ruleName=stringOrNull(row.rule_name),severity=stringOrNull(row.severity),detectedAt=safeIso(row.detected_at);
    if(!id||!ruleId||!ruleName||!severity||!detectedAt)throw new Error("Invalid forensic correlation");
    return {id,ruleId,ruleName,severity,description:textOrNull(row.description),eventCount:integer(row.event_count),detectedAt};
  });

  const protectionAlerts=body.protectionAlerts.map(value=>{
    const row=object(value),id=stringOrNull(row.id),evidenceId=stringOrNull(row.evidence_id),agentId=stringOrNull(row.agent_id),detectorId=stringOrNull(row.detector_id),severity=stringOrNull(row.severity),title=stringOrNull(row.title),createdAt=safeIso(row.created_at);
    if(!id||!evidenceId||!agentId||!detectorId||!severity||!title||!createdAt)throw new Error("Invalid forensic protection alert");
    return {id,evidenceId,agentId,detectorId,policyVersion:integer(row.policy_version),severity,title,createdAt,executionRequestId:stringOrNull(row.execution_request_id),responseStatus:stringOrNull(row.response_status),impactClass:stringOrNull(row.impact_class),requiredApprovals:integer(row.required_approvals),approvalCount:integer(row.approval_count)};
  });

  return {
    schemaVersion:1,generatedAt,integrityModel:"live-row-sha256",manifestSha256,signed:false,immutable:false,chainOfCustodyQualified:false,exportEnabled:false,
    incident:{id:incidentId,agentId:stringOrNull(incident.agent_id),source:stringOrNull(incident.source),node:stringOrNull(incident.node),severity:incidentSeverity,status:incidentStatus,title:incidentTitle,createdAt:incidentCreatedAt,updatedAt:safeIso(incident.updated_at),resolvedAt:safeIso(incident.resolved_at)},
    events,correlations,protectionAlerts,
  };
}

export async function fetchDeliveryPosture(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorDeliveryPosture>{
  const body=object(await readJson({...input,path:"/v1/machine/delivery-posture"}));
  if(body.mutationEnabled!==false||body.outboundTestEnabled!==false||!Array.isArray(body.integrations)||body.integrations.length>200||!Array.isArray(body.notificationChannels)||body.notificationChannels.length>200)throw new Error("Invalid delivery posture response");

  const integrations=body.integrations.map(value=>{
    const row=object(value),id=stringOrNull(row.integration_id),name=stringOrNull(row.name),type=stringOrNull(row.type),createdAt=safeIso(row.created_at);
    if(!id||!name||!type||!createdAt)throw new Error("Invalid integration posture row");
    return {id,name,type,enabled:bool(row.enabled),lastSyncAt:safeIso(row.last_sync_at),lastTestedAt:safeIso(row.last_tested_at),lastTestStatus:stringOrNull(row.last_test_status),lastTestError:textOrNull(row.last_test_error),createdAt,updatedAt:safeIso(row.updated_at)};
  });

  const notificationChannels=body.notificationChannels.map(value=>{
    const row=object(value),id=stringOrNull(row.channel_id),type=stringOrNull(row.type),name=stringOrNull(row.name),createdAt=safeIso(row.created_at);
    if(!id||!type||!name||!createdAt)throw new Error("Invalid notification channel row");
    return {id,type,name,enabled:bool(row.enabled),createdAt,updatedAt:safeIso(row.updated_at)};
  });

  const summary=object(body.notifications);
  return {
    integrations,notificationChannels,
    notifications:{
      total:integer(summary.total),pending:integer(summary.pending),sent:integer(summary.sent),failed:integer(summary.failed),read:integer(summary.read),
      critical:integer(summary.critical),high:integer(summary.high),latestSentAt:safeIso(summary.latestSentAt),latestCreatedAt:safeIso(summary.latestCreatedAt),
    },
    mutationEnabled:false,outboundTestEnabled:false,
  };
}

export async function fetchOperatorSnapshot(input:{origin:string;credential:string;fetcher?:typeof fetch}):Promise<OperatorSnapshot>{
  const calls=[
    fetchOperatorAssets(input),
    fetchOperatorIncidents(input),
    fetchOperatorAudit(input),
    fetchExecutionAuthority(input),
    fetchThreatIntelligence(input),
    fetchCorrelations(input),
    fetchCompliance(input),
    fetchPolicyPosture(input),
    fetchForensics(input),
    fetchProtectionAlerts(input),
    fetchDeliveryPosture(input),
  ] as const;
  const [assets,incidents,audit,execution,threatIntelligence,correlations,compliance,policyPosture,forensics,protectionAlerts,deliveryPosture]=await Promise.allSettled(calls);
  return {
    assets:assets.status==="fulfilled"?assets.value:null,
    incidents:incidents.status==="fulfilled"?incidents.value:null,
    audit:audit.status==="fulfilled"?audit.value:null,
    execution:execution.status==="fulfilled"?execution.value:null,
    threatIntelligence:threatIntelligence.status==="fulfilled"?threatIntelligence.value:null,
    correlations:correlations.status==="fulfilled"?correlations.value:null,
    compliance:compliance.status==="fulfilled"?compliance.value:null,
    policyPosture:policyPosture.status==="fulfilled"?policyPosture.value:null,
    forensics:forensics.status==="fulfilled"?forensics.value:null,
    protectionAlerts:protectionAlerts.status==="fulfilled"?protectionAlerts.value:null,
    deliveryPosture:deliveryPosture.status==="fulfilled"?deliveryPosture.value:null,
  };
}
