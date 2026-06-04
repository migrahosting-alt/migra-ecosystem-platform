import { panelQuery, isPanelDbConfigured } from "../db";

export type Website = { id: string; domain: string | null; status: string; tenantName: string | null; updatedAt: string | null };
export type Deployment = { id: string; status: string; createdAt: string | null; siteName: string | null };
export type ProvisioningTask = { id: string; status: string; type: string | null; createdAt: string | null };

export type HostingKpis = {
  totalSites: number;
  activeSites: number;
  expiringSslCount: number;
  recentDeployments: number;
  queuedTasks: number;
};

export const loadHostingKpis = async (): Promise<HostingKpis> => {
  if (!isPanelDbConfigured()) return { totalSites: 0, activeSites: 0, expiringSslCount: 0, recentDeployments: 0, queuedTasks: 0 };
  const [sites, active, ssl, deploys, tasks] = await Promise.all([
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int::text AS count FROM websites WHERE COALESCE(status, '') NOT IN ('deleted')`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int::text AS count FROM websites WHERE status = 'active'`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int::text AS count FROM ssl_certificates WHERE expires_at IS NOT NULL AND expires_at < NOW() + INTERVAL '30 days' AND expires_at > NOW()`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int::text AS count FROM deployments WHERE created_at >= NOW() - INTERVAL '7 days'`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int::text AS count FROM provisioning_tasks WHERE type LIKE 'hosting.%' AND status NOT IN ('completed','succeeded')`),
  ]);
  return {
    totalSites: Number(sites[0]?.count ?? 0),
    activeSites: Number(active[0]?.count ?? 0),
    expiringSslCount: Number(ssl[0]?.count ?? 0),
    recentDeployments: Number(deploys[0]?.count ?? 0),
    queuedTasks: Number(tasks[0]?.count ?? 0),
  };
};

export const loadHostingData = async () => {
  if (!isPanelDbConfigured()) return { websites: [], deployments: [], tasks: [] };
  const [websites, deployments, tasks] = await Promise.all([
    panelQuery<{ id: string; domain: string | null; status: string; tenantname: string | null; updatedat: string | null }>(
      `SELECT w.id, w."primaryDomain" AS domain, COALESCE(w.status, 'unknown') AS status, t.name AS tenantname, w."updatedAt"::text AS updatedat
         FROM websites w
         LEFT JOIN tenants t ON t.id = w."tenantId"
        ORDER BY w."updatedAt" DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; status: string; createdat: string | null; sitename: string | null }>(
      `SELECT d.id, COALESCE(d.status, 'unknown') AS status, d.created_at::text AS createdat,
              d.name AS sitename
         FROM deployments d
        ORDER BY d.created_at DESC NULLS LAST
        LIMIT 30`,
    ),
    panelQuery<{ id: string; status: string; type: string | null; createdat: string | null }>(
      `SELECT id, COALESCE(status, 'queued') AS status, type, "createdAt"::text AS createdat
         FROM provisioning_tasks
        WHERE status NOT IN ('completed','succeeded')
        ORDER BY "createdAt" DESC NULLS LAST
        LIMIT 30`,
    ),
  ]);
  return {
    websites: websites.map((w) => ({ id: w.id, domain: w.domain, status: w.status, tenantName: w.tenantname, updatedAt: w.updatedat })),
    deployments: deployments.map((d) => ({ id: d.id, status: d.status, createdAt: d.createdat, siteName: d.sitename })),
    tasks: tasks.map((t) => ({ id: t.id, status: t.status, type: t.type, createdAt: t.createdat })),
  };
};
