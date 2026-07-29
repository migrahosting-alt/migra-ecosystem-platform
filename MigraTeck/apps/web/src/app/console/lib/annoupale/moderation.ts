import "server-only";
import {
  adminGet,
  buildQuery,
  type AdminFetchReason,
} from "./admin-fetch";
import {
  parseModerationEnvelope,
  sanitizeModerationStatus,
  type ModerationQueueData,
} from "./moderation-contract";

/**
 * SERVER-ONLY loader for the native moderation queue
 * (GET /api/moderation/cases). Uses the shared per-operator bridge token; the
 * token never leaves the server. Returns customer-safe rows + derived rollups,
 * or a safe failure reason for the fallback panel.
 */

const PATH = "/api/moderation/cases";
const DEFAULT_LIMIT = 50;

export type ModerationQueueResult =
  | ({ connected: true } & ModerationQueueData)
  | { connected: false; reason: AdminFetchReason };

export async function loadModerationQueue(
  params: { status?: string | undefined; limit?: number | undefined } = {},
): Promise<ModerationQueueResult> {
  const status = sanitizeModerationStatus(params.status);
  const limit =
    params.limit && params.limit > 0 && params.limit <= 100
      ? params.limit
      : DEFAULT_LIMIT;
  const query = buildQuery({ status, limit });

  const res = await adminGet(`${PATH}${query}`, parseModerationEnvelope);
  if (!res.ok) return { connected: false, reason: res.reason };
  return { connected: true, ...res.data };
}
