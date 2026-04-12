import type { Finding } from "../autonomy/types";
import type { DriftCorrelation, DriftDiffResult } from "../drift/types";
import type { MissionAnalysis } from "./types";

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.filter((item) => item.trim().length > 0)));
}

function impactFromDiff(diff: DriftDiffResult): MissionAnalysis["impact"] {
  const tenants = new Set<string>(diff.summary.affectedTenants);
  const domains = new Set<string>();
  const pods = new Set<string>();
  const services = new Set<string>();

  for (const item of [...diff.added.pods, ...diff.removed.pods]) {
    if (item.tenantId) tenants.add(item.tenantId);
    pods.add(item.podId);
  }
  for (const change of diff.changed.pods) {
    pods.add(change.before.podId);
    pods.add(change.after.podId);
    if (change.before.tenantId) tenants.add(change.before.tenantId);
  }
  for (const item of [...diff.added.domains, ...diff.removed.domains]) {
    if (item.tenantId) tenants.add(item.tenantId);
    if (item.domain) domains.add(item.domain);
  }
  for (const change of diff.changed.domains) {
    domains.add(change.before.domain);
    domains.add(change.after.domain);
  }
  for (const item of [...diff.added.services, ...diff.removed.services]) {
    services.add(item.serviceId);
  }
  for (const change of diff.changed.services) {
    services.add(change.before.serviceId);
  }
  for (const edge of [...diff.added.edges, ...diff.removed.edges]) {
    services.add(edge.from);
    services.add(edge.to);
  }

  return {
    tenants: dedupe(Array.from(tenants)),
    domains: dedupe(Array.from(domains)),
    pods: dedupe(Array.from(pods)),
    services: dedupe(Array.from(services))
  };
}

function impactEmpty(): MissionAnalysis["impact"] {
  return { tenants: [], domains: [], pods: [], services: [] };
}

function recommendationFromSeverity(
  severity: "info" | "warn" | "critical",
  impact: MissionAnalysis["impact"],
  correlation: DriftCorrelation | null | undefined
): string {
  const tenantLabel =
    impact.tenants.length > 0
      ? `${impact.tenants.length} tenant(s) affected`
      : "no tenants directly affected";

  const causeLabel = correlation?.best
    ? `likely caused by mission ${correlation.best.missionId ?? correlation.best.journalEntryId ?? "unknown"} (confidence ${(correlation.best.score * 100).toFixed(0)}%)`
    : "cause unknown";

  if (severity === "critical") {
    return `Critical drift detected — ${tenantLabel}. ${causeLabel}. Validate DNS, SSL, and routing immediately. Review and confirm remediation plan before executing.`;
  }
  if (severity === "warn") {
    return `Non-critical drift detected — ${tenantLabel}. ${causeLabel}. Verify that the change was intentional and create a drift snapshot to confirm state.`;
  }
  return `Informational drift — ${tenantLabel}. ${causeLabel}. Review the change log and confirm no further action needed.`;
}

function proposedStepsFromDiff(
  diff: DriftDiffResult,
  hasCorrelation: boolean
): string[] {
  const steps: string[] = [];
  const added = diff.summary.totalAdded;
  const removed = diff.summary.totalRemoved;
  const changed = diff.summary.totalChanged;

  if (hasCorrelation) {
    steps.push("Review root cause mission and confirm it matches the observed change.");
  } else {
    steps.push("Investigate origin of drift — no matching mission/journal entry found.");
  }

  if (removed > 0) {
    steps.push(`Verify ${removed} removed item(s) were intentionally deprovisioned.`);
  }
  if (added > 0) {
    steps.push(`Confirm ${added} new item(s) are correctly provisioned and routed.`);
  }
  if (changed > 0) {
    steps.push(`Audit ${changed} changed item(s) for misconfiguration or security risk.`);
  }

  if (diff.summary.affectedClassification.internal > 0) {
    steps.push("Internal services affected — validate service topology and DNS.");
  }
  if (diff.summary.affectedClassification.client > 0) {
    steps.push("Client tenants affected — confirm SLA compliance and notify if necessary.");
  }

  steps.push("Create a new drift snapshot after remediation to confirm clean state.");
  return steps;
}

function confidenceFromFinding(finding: Finding): number {
  if (finding.severity === "critical") return 0.9;
  if (finding.severity === "warn") return 0.7;
  return 0.5;
}

export function buildAnalysisFromDrift(input: {
  diff: DriftDiffResult;
  correlation?: DriftCorrelation | null;
  findingId?: string;
}): MissionAnalysis {
  const { diff, correlation, findingId } = input;
  const impact = impactFromDiff(diff);
  const hasCorrelation = Boolean(correlation?.best && correlation.best.score >= 0.55);
  const baseConfidence = hasCorrelation ? clamp(correlation!.best!.score) : 0.4;
  const severityBoost =
    diff.summary.severity === "critical" ? 0.1 : diff.summary.severity === "warn" ? 0.05 : 0;
  const confidence = clamp(Number((baseConfidence + severityBoost).toFixed(4)));

  return {
    detectedFrom: "drift",
    impact,
    riskLevel: diff.summary.severity,
    confidence,
    recommendation: recommendationFromSeverity(diff.summary.severity, impact, correlation),
    proposedSteps: proposedStepsFromDiff(diff, hasCorrelation),
    correlationSummary: correlation?.summary,
    findingId,
    likelyCause: correlation?.best
      ? correlation.best.missionId ??
        correlation.best.journalEntryId ??
        undefined
      : undefined
  };
}

export function buildAnalysisFromFinding(input: {
  finding: Finding;
  detectedFrom?: MissionAnalysis["detectedFrom"];
}): MissionAnalysis {
  const { finding } = input;
  const confidence = confidenceFromFinding(finding);

  return {
    detectedFrom: input.detectedFrom ?? "finding",
    impact: impactEmpty(),
    riskLevel: finding.severity,
    confidence,
    recommendation: `Finding: ${finding.title}. Review details and determine if a remediation mission is needed.`,
    proposedSteps: [
      "Read the finding details and understand the affected scope.",
      "Check relevant service health and inventory state.",
      "If remediation is needed, confirm this mission plan before executing."
    ],
    findingId: finding.findingId
  };
}

export function buildAnalysisForChat(input: {
  goal: string;
  impactHint?: Partial<MissionAnalysis["impact"]>;
}): MissionAnalysis {
  const impact: MissionAnalysis["impact"] = {
    tenants: input.impactHint?.tenants ?? [],
    domains: input.impactHint?.domains ?? [],
    pods: input.impactHint?.pods ?? [],
    services: input.impactHint?.services ?? []
  };

  return {
    detectedFrom: "chat",
    impact,
    riskLevel: "info",
    confidence: 0.75,
    recommendation: `Goal: "${input.goal}". Review the proposed plan steps and confirm the scope is correct before executing.`,
    proposedSteps: [
      "Verify the affected tenants and domains are correct.",
      "Review the proposed task graph and confirm all tool calls are appropriate.",
      "Execute the plan step-by-step and monitor for unexpected changes."
    ]
  };
}
