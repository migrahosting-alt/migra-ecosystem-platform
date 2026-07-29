import "server-only";
import { adminGet, type AdminFetchReason } from "./admin-fetch";
import {
  parseAnalyticsSummary,
  parseAnalyticsRealtime,
  type AnalyticsSummary,
  type AnalyticsRealtime,
} from "./analytics-contract";

/**
 * SERVER-ONLY loader for AnnouPale platform analytics. Uses the shared
 * per-operator bridge token (never leaves the server). The summary drives the
 * Analytics & Timeline page; realtime is best-effort (its absence is not an
 * error). We never fabricate metrics — missing fields are simply not shown.
 */

const SUMMARY_PATH = "/api/admin/analytics/summary?includeTrends=true";
const REALTIME_PATH = "/api/admin/analytics/realtime";

export type AnalyticsResult =
  | { connected: true; summary: AnalyticsSummary; realtime: AnalyticsRealtime | null }
  | { connected: false; reason: AdminFetchReason };

export async function loadAnalytics(): Promise<AnalyticsResult> {
  const summaryRes = await adminGet(SUMMARY_PATH, parseAnalyticsSummary);
  if (!summaryRes.ok) return { connected: false, reason: summaryRes.reason };

  // Realtime is optional — never let its failure break the page.
  const realtimeRes = await adminGet(REALTIME_PATH, parseAnalyticsRealtime);
  const realtime = realtimeRes.ok ? realtimeRes.data : null;

  return { connected: true, summary: summaryRes.data, realtime };
}
