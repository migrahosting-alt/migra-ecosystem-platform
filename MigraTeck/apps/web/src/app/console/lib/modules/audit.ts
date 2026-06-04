import { randomUUID } from "node:crypto";
import { panelExec, panelQuery, isPanelDbConfigured } from "../db";

/**
 * Client lifecycle / mutation audit log.
 *
 * Every destructive or notable mutation on a tenant should call logClientEvent.
 * The activity timeline reads from this table.
 *
 * NB: this fn is fire-and-forget. It NEVER throws — auditing must never block
 * the user's actual mutation. Failures are logged to stderr only.
 */

export type ClientEventInput = {
  tenantId: string;
  action: string;             // e.g. "tenant.suspend" | "subscription.cancel" | "addon.add"
  actorEmail?: string | null;
  resource?: string | null;
  resourceId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  result?: "success" | "failure";
  error?: string | null;
};

export type ClientEvent = {
  id: string;
  tenantId: string;
  actorEmail: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  result: string;
  error: string | null;
  createdAt: string | null;
};

export const logClientEvent = async (input: ClientEventInput): Promise<void> => {
  if (!isPanelDbConfigured() || !input.tenantId || !input.action) return;
  try {
    await panelExec(
      `INSERT INTO client_events
         (id, tenant_id, actor_email, action, resource, resource_id, reason, metadata, result, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        randomUUID(),
        input.tenantId,
        input.actorEmail ?? null,
        input.action,
        input.resource ?? null,
        input.resourceId ?? null,
        input.reason ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.result ?? "success",
        input.error ?? null,
      ],
    );
  } catch (err) {
    console.error("[audit] logClientEvent failed", {
      action: input.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

export type RecentEventsQuery = {
  /** Free-text search on actor email or reason. */
  q?: string;
  /** Filter to one or more action keys. */
  actions?: string[];
  /** Filter to one tenant. */
  tenantId?: string;
  /** Only show failure events. */
  failuresOnly?: boolean;
  /** Pagination */
  limit?: number;
  offset?: number;
};

/**
 * Cross-tenant timeline. Used by /console/activity to answer
 * "what did the team do today?".
 */
export const loadAllRecentEvents = async (
  query: RecentEventsQuery = {},
): Promise<(ClientEvent & { tenantName: string | null })[]> => {
  if (!isPanelDbConfigured()) return [];

  const where: string[] = [];
  const params: Array<string | number | boolean | null | Date> = [];

  if (query.q) {
    params.push(`%${query.q.toLowerCase()}%`);
    const i = params.length;
    where.push(
      `(LOWER(COALESCE(e.actor_email,'')) LIKE $${i} OR LOWER(COALESCE(e.reason,'')) LIKE $${i} OR LOWER(COALESCE(t.name,'')) LIKE $${i})`,
    );
  }
  if (query.actions && query.actions.length > 0) {
    params.push(`{${query.actions.join(",")}}`);
    where.push(`e.action = ANY($${params.length}::text[])`);
  }
  if (query.tenantId) {
    params.push(query.tenantId);
    where.push(`e.tenant_id = $${params.length}`);
  }
  if (query.failuresOnly) {
    where.push(`e.result = 'failure'`);
  }

  const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
  const offset = Math.max(0, query.offset ?? 0);
  params.push(limit);
  params.push(offset);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await panelQuery<{
    id: string;
    tenant_id: string;
    tenant_name: string | null;
    actor_email: string | null;
    action: string;
    resource: string | null;
    resource_id: string | null;
    reason: string | null;
    metadata: unknown;
    result: string;
    error: string | null;
    created_at: string | null;
  }>(
    `SELECT e.id, e.tenant_id,
            COALESCE(t.name, t.company_name, t.slug) AS tenant_name,
            e.actor_email, e.action, e.resource, e.resource_id, e.reason,
            e.metadata, e.result, e.error, e.created_at::text AS created_at
       FROM client_events e
       LEFT JOIN tenants t ON t.id = e.tenant_id
       ${whereSql}
       ORDER BY e.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    actorEmail: r.actor_email,
    action: r.action,
    resource: r.resource,
    resourceId: r.resource_id,
    reason: r.reason,
    metadata: (r.metadata && typeof r.metadata === "object") ? (r.metadata as Record<string, unknown>) : {},
    result: r.result,
    error: r.error,
    createdAt: r.created_at,
  }));
};

/** List of distinct action keys recently seen, for the activity filter dropdown. */
export const loadDistinctActions = async (sinceDays = 30): Promise<string[]> => {
  if (!isPanelDbConfigured()) return [];
  const rows = await panelQuery<{ action: string }>(
    `SELECT DISTINCT action FROM client_events
      WHERE created_at >= NOW() - ($1 || ' days')::interval
      ORDER BY action ASC
      LIMIT 200`,
    [String(Math.max(1, sinceDays))],
  );
  return rows.map((r) => r.action);
};

export const loadClientTimeline = async (
  tenantId: string,
  limit = 50,
): Promise<ClientEvent[]> => {
  if (!isPanelDbConfigured() || !tenantId) return [];
  const rows = await panelQuery<{
    id: string;
    tenant_id: string;
    actor_email: string | null;
    action: string;
    resource: string | null;
    resource_id: string | null;
    reason: string | null;
    metadata: unknown;
    result: string;
    error: string | null;
    created_at: string | null;
  }>(
    `SELECT id, tenant_id, actor_email, action, resource, resource_id, reason,
            metadata, result, error, created_at::text AS created_at
       FROM client_events
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [tenantId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    actorEmail: r.actor_email,
    action: r.action,
    resource: r.resource,
    resourceId: r.resource_id,
    reason: r.reason,
    metadata: (r.metadata && typeof r.metadata === "object") ? (r.metadata as Record<string, unknown>) : {},
    result: r.result,
    error: r.error,
    createdAt: r.created_at,
  }));
};

/**
 * Human-readable label for an action key. Centralized so the timeline UI
 * doesn't have to know about every action string.
 */
export const describeAction = (action: string): string => {
  const map: Record<string, string> = {
    "tenant.create": "Created client",
    "tenant.update": "Edited client profile",
    "tenant.delete": "Soft-deleted client",
    "tenant.activate": "Activated client",
    "tenant.suspend": "Suspended client",
    "tenant.cancel": "Cancelled client",
    "tenant.resume": "Resumed client",
    "tenant.renew": "Queued account renewal",
    "tenant.reactivate": "Reactivated client",
    "subscription.pause": "Paused subscription",
    "subscription.resume": "Resumed subscription",
    "subscription.cancel": "Cancelled subscription",
    "subscription.renew": "Queued subscription renewal",
    "subscription.add": "Added subscription",
    "addon.add": "Added addon",
    "order.add": "Added product order",
    "order.payment_link_sent": "Sent payment link",
    "note.add": "Added internal note",
    "note.pin": "Pinned note",
    "note.unpin": "Unpinned note",
    "note.delete": "Deleted internal note",
    "contact.add": "Added contact",
    "contact.update": "Updated contact",
    "contact.delete": "Removed contact",
    "hosting.suspend": "Suspended hosting site",
    "hosting.resume": "Resumed hosting site",
    "hosting.deploy": "Queued site deploy",
    "hosting.ssl_renew": "Forced SSL renewal",
    "hosting.backup": "Queued site backup",
  };
  return map[action] || action;
};
