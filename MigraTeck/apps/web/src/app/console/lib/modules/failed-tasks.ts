import { panelQuery, isPanelDbConfigured } from "../db";

export type FailedTask = {
  id: string;
  type: string;
  status: string;
  serviceInstanceId: string | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/**
 * Recent failed / errored provisioning tasks for a tenant. Surfaced on the
 * client detail page so the admin sees billing/provisioning failures before
 * the customer calls.
 */
export const loadFailedTasksForTenant = async (
  tenantId: string,
  limit = 5,
): Promise<FailedTask[]> => {
  if (!isPanelDbConfigured() || !tenantId) return [];
  const rows = await panelQuery<{
    id: string;
    type: string;
    status: string;
    serviceinstanceid: string | null;
    error: string | null;
    createdat: string | null;
    updatedat: string | null;
  }>(
    `SELECT id, type, status,
            "serviceInstanceId" AS serviceinstanceid,
            COALESCE("lastError", error, NULL) AS error,
            "createdAt"::text AS createdat,
            COALESCE("updatedAt", "createdAt")::text AS updatedat
       FROM provisioning_tasks
      WHERE "tenantId" = $1
        AND status IN ('failed','dead','error','retrying')
      ORDER BY "createdAt" DESC NULLS LAST
      LIMIT $2`,
    [tenantId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    serviceInstanceId: r.serviceinstanceid,
    error: r.error,
    createdAt: r.createdat,
    updatedAt: r.updatedat,
  }));
};
