import { panelQuery, isPanelDbConfigured } from "../db";

export type Job = { id: string; name: string | null; type: string | null; status: string };
export type JobRun = { id: string; jobId: string | null; jobName: string | null; status: string; startedAt: string | null; finishedAt: string | null };
export type Webhook = { id: string; url: string | null; event: string | null; status: string; lastFiredAt: string | null };

export const loadAutomationData = async () => {
  if (!isPanelDbConfigured()) return { jobs: [], runs: [], webhooks: [] };
  const [jobs, runs, webhooks] = await Promise.all([
    panelQuery<{ id: string; name: string | null; type: string | null; status: string }>(
      `SELECT id,
              COALESCE("payloadJson"->>'name', type) AS name,
              type,
              COALESCE(status, 'active') AS status
         FROM jobs
        ORDER BY "createdAt" DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; jobid: string | null; jobname: string | null; status: string; startedat: string | null; finishedat: string | null }>(
      `SELECT jr.id, jr."jobId" AS jobid, j.type AS jobname,
              COALESCE(jr.status, 'unknown') AS status,
              jr."startedAt"::text AS startedat,
              jr."finishedAt"::text AS finishedat
         FROM job_runs jr
         LEFT JOIN jobs j ON j.id = jr."jobId"
        ORDER BY jr."startedAt" DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; url: string | null; event: string | null; status: string; lastfiredat: string | null }>(
      `SELECT we.id, we.url, NULL::text AS event, CASE WHEN we.active THEN 'active' ELSE 'inactive' END AS status,
              (SELECT MAX(wd.created_at)::text FROM webhook_deliveries wd WHERE wd.webhook_id = we.id) AS lastfiredat
         FROM webhook_endpoints we
        ORDER BY we.created_at DESC NULLS LAST
        LIMIT 30`,
    ),
  ]);
  return {
    jobs: jobs.map((j) => ({ id: j.id, name: j.name, type: j.type, status: j.status })),
    runs: runs.map((r) => ({ id: r.id, jobId: r.jobid, jobName: r.jobname, status: r.status, startedAt: r.startedat, finishedAt: r.finishedat })),
    webhooks: webhooks.map((w) => ({ id: w.id, url: w.url, event: w.event, status: w.status, lastFiredAt: w.lastfiredat })),
  };
};
