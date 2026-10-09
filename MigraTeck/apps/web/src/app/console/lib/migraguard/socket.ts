import http from "node:http";
export type Coverage = {state:"unknown"|"reporting"|"degraded";collectors:{name:string;lastSeen:string|null;state:"stale"|"degraded"|"reporting"}[]};
export type CommandCenter = {
  generatedAt:string;
  windowHours:number;
  overall:{state:"normal"|"elevated"|"critical"|"unknown";reason:string;lastVerifiedAt:string|null};
  assets:{total:number;reporting:number;degraded:number;offline:number;authoritative:boolean;rows:Array<{
    name:string;state:"stale"|"degraded"|"reporting";lastEvidenceAt:string|null;evidence24h:number;
    edge24h:number;identity24h:number;api24h:number;infrastructure24h:number;secrets24h:number;supplyChain24h:number;content24h:number;mail24h:number;malware24h:number;monitoring24h:number;
    inventoryId?:string;type?:string;ipAddress?:string|null;riskScore?:number|null;lastScanAt?:string|null;
  }>};
  incidents:{connected:boolean;active:number;critical:number;items:Array<{id:string;title:string;summary:string;category:string;
    severity:string;status:string;riskScore:number;openedAt:string|null;updatedAt:string|null}>};
  threats:{counts:{edge:number;identity:number;api:number;infrastructure:number;malware:number;monitoring:number;
    wafBlocked:number;wafDetected:number;bruteForce:number;malwareDetected:number;scanFailures:number};
    attackSummary:{observed:number;blocked:number;detected:number;brute_force:number;auth_compromise:number;malware:number};
    trend:Array<{bucket:string;edge:number;identity:number;malware:number;infrastructure:number}>};
  activity:Array<{id:string;severity:"critical"|"high"|"medium"|"low"|"info";domain:string;title:string;source:string;
    target:string;assetName?:string|null;detection:string;evidenceId:string;evidence:string[];action:string;state:string;timestamp:string}>;
  domains:Array<{key:string;name:string;state:"active"|"attention"|"critical"|"limited"|"unconnected";events:number|null;detail:string}>;
  response:{automaticRemediation:false;authority:"not-connected"|"governed";executorEnabled:false;pendingApprovals:number;blocked:number;queued:number;
    executed:number;dryRun:number;inEffect:number;rollbackAvailable:false;
    capabilities:{active:number;consumed:number;revoked:number;expired:number};
    receipts:{total:number;succeeded:number;failed:number;unknown:number;latestAt:string|null};
    requests:Array<{id:string;status:string;impactClass:string;approvalCount:number;requiredApprovals:number;target:string;policy:string;createdAt:string;expiresAt:string}>;
    actions:Array<{type:string;status:string;count:number;latestAt:string|null}>};
  policies:{runtimeDetector:{name:string;version:number;state:"active"};managed:number};
  audit:{canonicalEvents:number;lastEventAt:string|null;state:"partial"|"connected";connected:boolean;
    events:Array<{id:string;actorType:string;actorId:string|null;action:string;target:string;outcome:string;createdAt:string}>};
  authorities?:Array<{key:string;name:string;state:"connected"|"unavailable";detail:string;href:string}>;
};
export function socketRead<T>(path:string):Promise<T> {
  return new Promise((resolve,reject)=>{
    const socketPath=process.env.MIGRAGUARD_SOCKET_PATH??"/run/migraguard-console/feed.sock";
    const request=http.get({socketPath,path,timeout:10000},response=>{
      let body="";
      response.on("data",chunk=>{body+=chunk;if(body.length>128*1024)request.destroy(new Error("Oversized feed"));});
      response.on("end",()=>{try{if(response.statusCode!==200)throw new Error("Feed unavailable");resolve(JSON.parse(body) as T);}catch(error){reject(error);}});
      response.on("error",reject);
    });
    request.on("timeout",()=>request.destroy(new Error("Feed timeout")));
    request.on("error",reject);
  });
}
