import "server-only";
import { loadComplianceQueue } from "./compliance";
import { loadAppeals } from "./compliance-appeals";
import { loadModerationQueue } from "./moderation";
import { loadAuditLog } from "./audit";
import { loadAnnoupaleHealth, type HealthResult } from "./health";
import type { ComplianceCaseRow, ComplianceSummary } from "./compliance-contract";
import { deriveAttention, type AttentionResult } from "./attention-contract";

/**
 * SERVER-ONLY composer for the AnnouPale Trust & Operations overview.
 *
 * Fans out to the native loaders in parallel and assembles the dashboard's five
 * stat cards, the recent-cases table, and a DATA-DRIVEN alert list. Every number
 * comes from a real endpoint; a section that can't load degrades to a
 * `connected: false` card instead of showing a fabricated value. Alerts are
 * derived only from signals the queue actually exposes (never invented).
 */

export type OverviewAlertSeverity = "critical" | "warning" | "info";
export type OverviewAlert = {
  id: string;
  severity: OverviewAlertSeverity;
  title: string;
  detail: string;
  href?: string;
};

export type OverviewData = {
  compliance:
    | { connected: true; summary: ComplianceSummary; total: number; recent: ComplianceCaseRow[] }
    | { connected: false };
  appeals:
    | { connected: true; openPending: number; waiting: number }
    | { connected: false };
  moderation:
    | { connected: true; pending: number; highPriority: number }
    | { connected: false };
  audit:
    | { connected: true; windowCount: number; windowCapped: boolean }
    | { connected: false };
  health: HealthResult;
  alerts: OverviewAlert[];
  /** urgent + high open compliance cases — drives the topbar attention badge */
  attentionCount: number | null;
  /** derived "Attention Required" panel data (real signals + unavailable warnings) */
  attention: AttentionResult;
};

/** Whole-day age of an ISO timestamp, or null when unparseable. nowMs injectable for tests. */
export function ageDaysOf(iso: string, nowMs: number): number | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** Oldest open (non-resolved) case in a loaded window, or null. nowMs injectable. */
export function oldestOpenCase(
  cases: ReadonlyArray<{ caseId: string; status: string; createdAt: string }>,
  nowMs: number,
): { caseId: string; ageDays: number } | null {
  let best: { caseId: string; ageDays: number; t: number } | null = null;
  for (const c of cases) {
    if (RESOLVED.has(c.status)) continue;
    const t = new Date(c.createdAt).getTime();
    if (Number.isNaN(t)) continue;
    if (!best || t < best.t) {
      best = { caseId: c.caseId, ageDays: ageDaysOf(c.createdAt, nowMs) ?? 0, t };
    }
  }
  return best ? { caseId: best.caseId, ageDays: best.ageDays } : null;
}

/** Request types that always warrant a critical alert when present and unresolved. */
const CRITICAL_SAFETY = new Set(["child_safety", "underage", "self_harm"]);
const RESOLVED = new Set(["closed", "denied", "actioned"]);

export async function loadOverview(): Promise<OverviewData> {
  const [compRes, appealsRes, modRes, auditRes, healthRes] = await Promise.all([
    loadComplianceQueue({}),
    loadAppeals({}),
    loadModerationQueue({}),
    loadAuditLog({}),
    loadAnnoupaleHealth(),
  ]);

  const alerts: OverviewAlert[] = [];
  let attentionCount: number | null = null;

  const compliance: OverviewData["compliance"] = compRes.connected
    ? {
        connected: true,
        summary: compRes.summary,
        total: compRes.total,
        recent: compRes.cases.slice(0, 6),
      }
    : { connected: false };

  if (compRes.connected) {
    attentionCount = compRes.summary.urgent + compRes.summary.high;

    // Critical-safety alert — derived from real request types in the live queue.
    const criticalCase = compRes.cases.find(
      (c) => CRITICAL_SAFETY.has(c.requestType) && !RESOLVED.has(c.status),
    );
    if (criticalCase) {
      alerts.push({
        id: "critical-safety",
        severity: "critical",
        title: "Critical safety case open",
        detail: `Case ${criticalCase.caseId} (${criticalCase.requestType.replace(/_/g, " ")}) needs immediate review.`,
        href: `/console/annoupale/compliance/${encodeURIComponent(criticalCase.caseId)}`,
      });
    }

    if (compRes.summary.urgent > 0) {
      alerts.push({
        id: "urgent-compliance",
        severity: "warning",
        title: `${compRes.summary.urgent} urgent compliance case${compRes.summary.urgent === 1 ? "" : "s"}`,
        detail: "Urgent-priority cases are awaiting triage.",
        href: "/console/annoupale/compliance?priority=urgent",
      });
    }

    const escalated = compRes.cases.filter((c) => c.status === "escalated").length;
    if (escalated > 0) {
      alerts.push({
        id: "escalated",
        severity: "warning",
        title: `${escalated} escalated case${escalated === 1 ? "" : "s"}`,
        detail: "Escalated cases may require legal or leadership review.",
        href: "/console/annoupale/compliance?status=escalated",
      });
    }
  }

  const appeals: OverviewData["appeals"] = appealsRes.connected
    ? {
        connected: true,
        openPending: appealsRes.summary.open,
        waiting: appealsRes.summary.waiting,
      }
    : { connected: false };

  const moderation: OverviewData["moderation"] = modRes.connected
    ? { connected: true, pending: modRes.summary.pending, highPriority: modRes.summary.highPriority }
    : { connected: false };

  if (modRes.connected && modRes.summary.highPriority > 0) {
    alerts.push({
      id: "moderation-high",
      severity: "warning",
      title: `${modRes.summary.highPriority} high-priority moderation case${modRes.summary.highPriority === 1 ? "" : "s"}`,
      detail: "High/critical moderation cases are pending action.",
      href: "/console/annoupale/moderation",
    });
  }

  const audit: OverviewData["audit"] = auditRes.connected
    ? { connected: true, windowCount: auditRes.windowCount, windowCapped: auditRes.windowCapped }
    : { connected: false };

  if (healthRes.reachable && healthRes.status === "degraded") {
    alerts.push({
      id: "health-degraded",
      severity: "critical",
      title: "Platform health degraded",
      detail: "One or more AnnouPale dependencies are not healthy.",
    });
  }

  // "Attention Required" panel — real signals only; failed loaders surface as
  // honest "unavailable" warnings (never a fabricated zero).
  const unavailableSections: string[] = [];
  if (!compRes.connected) unavailableSections.push("Compliance");
  if (!appealsRes.connected) unavailableSections.push("Appeals");
  if (!modRes.connected) unavailableSections.push("Moderation");
  if (!auditRes.connected) unavailableSections.push("Audit log");
  if (!healthRes.reachable) unavailableSections.push("Platform health");

  const attention = deriveAttention({
    complianceConnected: compRes.connected,
    urgent: compRes.connected ? compRes.summary.urgent : 0,
    high: compRes.connected ? compRes.summary.high : 0,
    oldestOpen: compRes.connected ? oldestOpenCase(compRes.cases, Date.now()) : null,
    appealsConnected: appealsRes.connected,
    appealsWaiting: appealsRes.connected ? appealsRes.summary.waiting : 0,
    unavailableSections,
  });

  return {
    compliance,
    appeals,
    moderation,
    audit,
    health: healthRes,
    alerts,
    attentionCount,
    attention,
  };
}
