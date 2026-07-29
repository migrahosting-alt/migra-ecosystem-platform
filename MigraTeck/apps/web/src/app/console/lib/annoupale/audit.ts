import "server-only";
import { adminGet, buildQuery, type AdminFetchReason } from "./admin-fetch";
import { parseAuditEnvelope, type AuditEventRow } from "./audit-contract";

/**
 * SERVER-ONLY loader for the AnnouPale audit log (GET /api/admin/audit-logs).
 * Uses the shared per-operator bridge token (never leaves the server). Drops
 * ipHash / metadata via the contract gate. Computes a real "last 24h" event
 * count by querying with a dateFrom window.
 */

const PATH = "/api/admin/audit-logs";
const MAX_LIMIT = 200;

export type AuditLogResult =
  | {
      connected: true;
      items: AuditEventRow[];
      /** count of events within the window (capped at MAX_LIMIT) */
      windowCount: number;
      /** true when more than MAX_LIMIT events fell in the window */
      windowCapped: boolean;
    }
  | { connected: false; reason: AdminFetchReason };

/**
 * Loads recent audit events. `windowHours` (default 24) sets the dateFrom bound
 * used for the headline count. `nowMs` is injectable for testing; defaults to
 * the current time on the server.
 */
export async function loadAuditLog(
  params: { windowHours?: number; limit?: number; nowMs?: number } = {},
): Promise<AuditLogResult> {
  const windowHours = params.windowHours && params.windowHours > 0 ? params.windowHours : 24;
  const limit = params.limit && params.limit > 0 && params.limit <= MAX_LIMIT ? params.limit : MAX_LIMIT;
  const nowMs = params.nowMs ?? Date.now();
  const dateFrom = new Date(nowMs - windowHours * 3600_000).toISOString();

  const query = buildQuery({ dateFrom, limit });
  const res = await adminGet(`${PATH}${query}`, parseAuditEnvelope);
  if (!res.ok) return { connected: false, reason: res.reason };

  return {
    connected: true,
    items: res.data.items,
    windowCount: res.data.items.length,
    windowCapped: res.data.hasMore,
  };
}
