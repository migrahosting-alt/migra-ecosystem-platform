/** Read-only console contract. Identity and tenant scope never come from URL parameters. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Query = (sql: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export type GuardScope = { tenantId: string };
export type Alert = {
  id: string; title: string; severity: "high" | "critical"; createdAt: string;
  evidenceId: string; agentId: string; credentialId: string; detector: string;
  policyVersion: number; eventType: string; receivedAt: string;
};
export type AlertPresentation = {
  title: string;
  summary: string;
  nextStep: string;
  signal: string;
};

const alertPresentations: Record<string, AlertPresentation> = {
  "malware.detected": {
    title: "Malware was detected",
    summary: "A collector reported a malware finding that requires operator review.",
    nextStep: "Review the evidence and confirm the affected system before authorizing any response.",
    signal: "Malware detection",
  },
  "auth.success_after_failures": {
    title: "Sign-in succeeded after repeated failures",
    summary: "A successful sign-in followed a pattern of repeated authentication failures.",
    nextStep: "Validate the account activity and source before deciding whether access should be restricted.",
    signal: "Authentication anomaly",
  },
  "auth.bruteforce": {
    title: "Repeated sign-in failures",
    summary: "A collector reported an unusual concentration of failed sign-in attempts.",
    nextStep: "Review the source and affected account activity for signs of unauthorized access.",
    signal: "Authentication failures",
  },
  "malware.scan_failed": {
    title: "Malware scan did not complete",
    summary: "A collector could not complete a monitoring scan, reducing current coverage.",
    nextStep: "Confirm the collector is healthy and restore the affected scan before relying on full coverage.",
    signal: "Scan coverage",
  },
  "selfcheck.silent_failure": {
    title: "Monitoring control needs attention",
    summary: "A collector reported that one of its monitoring checks did not complete correctly.",
    nextStep: "Review the collector health and restore the affected monitoring check.",
    signal: "Collector health",
  },
};

export function presentAlert(alert: Pick<Alert, "eventType" | "title">): AlertPresentation {
  return alertPresentations[alert.eventType] ?? {
    title: alert.title || "Security observation needs review",
    summary: "MigraGuard recorded a security observation that requires operator review.",
    nextStep: "Review the verified evidence before deciding whether a response is required.",
    signal: "Security observation",
  };
}
export function authorizeScope(
  session: { email: string; exp: number } | null,
  adminEmail: string | undefined,
  tenantId: string | undefined,
  now = Date.now(),
): GuardScope | null {
  if (!session || !Number.isFinite(session.exp) || session.exp * 1000 <= now) return null;
  if (!adminEmail?.trim() || session.email.trim().toLowerCase() !== adminEmail.trim().toLowerCase()) return null;
  return tenantId && UUID.test(tenantId) ? { tenantId } : null;
}
export function filters(input: { severity?: string | string[]; page?: string | string[] }) {
  const severity = input.severity === "high" || input.severity === "critical" ? input.severity : "all";
  const page = typeof input.page === "string" && /^[1-9]\d{0,3}$/.test(input.page) ? Number(input.page) : 1;
  return { severity, page };
}
const fields = `a.alert_id,a.tenant_id,a.title,a.severity,a.created_at,a.evidence_id,
  a.agent_id,a.agent_credential_id,a.detector_id,a.policy_version,e.event_type,e.received_at`;
const source = `FROM protection_alerts a JOIN security_event_ingest e
  ON e.ingest_id=a.evidence_id AND e.tenant_id=a.tenant_id
  AND e.agent_id=a.agent_id AND e.agent_credential_id=a.agent_credential_id`;
function project(row: Record<string, unknown>, scope: GuardScope): Alert {
  if (row.tenant_id !== scope.tenantId || !["high", "critical"].includes(String(row.severity))) throw new Error("Invalid alert scope");
  const id = (key: string) => { const value = String(row[key]); if (!UUID.test(value)) throw new Error("Invalid alert identity"); return value; };
  const date = (key: string) => new Date(row[key] as string | Date).toISOString();
  // Explicit allowlist: raw evidence payload and credentials must never reach UI props.
  return { id:id("alert_id"), title:String(row.title).slice(0,512), severity:row.severity as Alert["severity"],
    createdAt:date("created_at"), evidenceId:id("evidence_id"), agentId:id("agent_id"), credentialId:id("agent_credential_id"),
    detector:String(row.detector_id).slice(0,100), policyVersion:Number(row.policy_version),
    eventType:String(row.event_type).slice(0,100), receivedAt:date("received_at") };
}
export async function listAlerts(query: Query, scope: GuardScope, input: ReturnType<typeof filters>) {
  if (!UUID.test(scope.tenantId)) throw new Error("Invalid tenant");
  const result = await query(`SELECT ${fields} ${source}
    WHERE a.tenant_id=$1 AND ($2::text='all' OR a.severity=$2)
    ORDER BY a.created_at DESC,a.alert_id DESC LIMIT 51 OFFSET $3`, [scope.tenantId,input.severity,(input.page-1)*50]);
  return { alerts:result.rows.slice(0,50).map(row=>project(row,scope)), hasNext:result.rows.length>50 };
}
export async function findAlert(query: Query, scope: GuardScope, id: string) {
  if (!UUID.test(scope.tenantId) || !UUID.test(id)) return null;
  const result = await query(`SELECT ${fields} ${source} WHERE a.tenant_id=$1 AND a.alert_id=$2`, [scope.tenantId,id]);
  return result.rows[0] ? project(result.rows[0],scope) : null;
}
