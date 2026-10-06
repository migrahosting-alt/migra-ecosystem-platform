import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getDb } from "./db.js";

export type UsageWindow = "24h" | "7d" | "30d";

const WINDOW_INTERVALS: Record<UsageWindow, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export function sanitizeApiRoute(request: FastifyRequest): string {
  const pattern = request.routeOptions?.url;
  if (pattern) return pattern;
  try {
    return new URL(request.url, "http://localhost").pathname;
  } catch {
    return request.url.split("?")[0] ?? "/";
  }
}

export async function recordApiRequestUsage(request: FastifyRequest, statusCode: number) {
  const principal = request.apiKeyPrincipal;
  if (!principal) return;

  const startedAt = request.apiRequestStartedAt ?? Date.now();
  const durationMs = Math.max(0, Date.now() - startedAt);
  const route = sanitizeApiRoute(request);
  const metadata = {
    kind: "api_request",
    api_key_id: principal.id,
    public_key_id: principal.publicKeyId,
    key_name: principal.name,
    method: request.method,
    route,
    status_code: statusCode,
    duration_ms: durationMs,
    request_id: request.id,
    rate_limited: statusCode === 429,
  };

  await getDb().query(
    'INSERT INTO "UsageEvent" (id,"orgId",product,metric,quantity,metadata,timestamp) VALUES ($1,$2,\'MIGRATECK\'::"ProductKey",\'API_CALLS\'::"UsageMetric",1,$3::jsonb,NOW())',
    [randomUUID(), principal.orgId, JSON.stringify(metadata)],
  );
}

export async function getDeveloperUsageSnapshot(orgId: string, window: UsageWindow) {
  const db = getDb();
  const interval = WINDOW_INTERVALS[window];

  const [summary, byKey, topRoutes, recent, quotas, keyStates] = await Promise.all([
    db.query(
      `SELECT
         count(*)::int AS requests,
         count(*) FILTER (WHERE COALESCE((metadata->>'status_code')::int,0) BETWEEN 200 AND 399)::int AS successful,
         count(*) FILTER (WHERE COALESCE((metadata->>'status_code')::int,0) BETWEEN 400 AND 499)::int AS client_errors,
         count(*) FILTER (WHERE COALESCE((metadata->>'status_code')::int,0) >= 500)::int AS server_errors,
         count(*) FILTER (WHERE COALESCE((metadata->>'rate_limited')::boolean,false))::int AS rate_limited,
         COALESCE(round(avg(NULLIF(metadata->>'duration_ms','')::numeric),1),0) AS avg_latency_ms,
         COALESCE(round((percentile_cont(0.95) WITHIN GROUP (ORDER BY NULLIF(metadata->>'duration_ms','')::numeric))::numeric,1),0) AS p95_latency_ms
       FROM "UsageEvent"
       WHERE "orgId"=$1
         AND product='MIGRATECK'::"ProductKey"
         AND metric='API_CALLS'::"UsageMetric"
         AND metadata->>'kind'='api_request'
         AND timestamp >= NOW() - $2::interval`,
      [orgId, interval],
    ),
    db.query(
      `SELECT
         metadata->>'api_key_id' AS "apiKeyId",
         metadata->>'public_key_id' AS "publicKeyId",
         metadata->>'key_name' AS "keyName",
         count(*)::int AS requests,
         count(*) FILTER (WHERE COALESCE((metadata->>'status_code')::int,0) BETWEEN 200 AND 399)::int AS successful,
         count(*) FILTER (WHERE COALESCE((metadata->>'status_code')::int,0) >= 400)::int AS errors,
         COALESCE(round(avg(NULLIF(metadata->>'duration_ms','')::numeric),1),0) AS "avgLatencyMs",
         max(timestamp) AS "lastSeenAt"
       FROM "UsageEvent"
       WHERE "orgId"=$1
         AND product='MIGRATECK'::"ProductKey"
         AND metric='API_CALLS'::"UsageMetric"
         AND metadata->>'kind'='api_request'
         AND timestamp >= NOW() - $2::interval
       GROUP BY metadata->>'api_key_id', metadata->>'public_key_id', metadata->>'key_name'
       ORDER BY requests DESC, "lastSeenAt" DESC
       LIMIT 50`,
      [orgId, interval],
    ),
    db.query(
      `SELECT
         metadata->>'method' AS method,
         metadata->>'route' AS route,
         count(*)::int AS requests,
         count(*) FILTER (WHERE COALESCE((metadata->>'status_code')::int,0) >= 400)::int AS errors,
         COALESCE(round(avg(NULLIF(metadata->>'duration_ms','')::numeric),1),0) AS "avgLatencyMs"
       FROM "UsageEvent"
       WHERE "orgId"=$1
         AND product='MIGRATECK'::"ProductKey"
         AND metric='API_CALLS'::"UsageMetric"
         AND metadata->>'kind'='api_request'
         AND timestamp >= NOW() - $2::interval
       GROUP BY metadata->>'method', metadata->>'route'
       ORDER BY requests DESC
       LIMIT 20`,
      [orgId, interval],
    ),
    db.query(
      `SELECT
         id,
         timestamp,
         metadata->>'api_key_id' AS "apiKeyId",
         metadata->>'public_key_id' AS "publicKeyId",
         metadata->>'key_name' AS "keyName",
         metadata->>'method' AS method,
         metadata->>'route' AS route,
         COALESCE((metadata->>'status_code')::int,0) AS "statusCode",
         COALESCE((metadata->>'duration_ms')::int,0) AS "durationMs",
         metadata->>'request_id' AS "requestId",
         COALESCE((metadata->>'rate_limited')::boolean,false) AS "rateLimited"
       FROM "UsageEvent"
       WHERE "orgId"=$1
         AND product='MIGRATECK'::"ProductKey"
         AND metric='API_CALLS'::"UsageMetric"
         AND metadata->>'kind'='api_request'
         AND timestamp >= NOW() - $2::interval
       ORDER BY timestamp DESC
       LIMIT 100`,
      [orgId, interval],
    ),
    db.query(
      `SELECT
         id,
         product::text AS product,
         metric::text AS metric,
         "limitValue"::text AS "limitValue",
         "currentUsed"::text AS "currentUsed",
         "periodStart",
         "periodEnd",
         "updatedAt"
       FROM "UsageQuota"
       WHERE "orgId"=$1
       ORDER BY "periodEnd" ASC, product ASC, metric ASC`,
      [orgId],
    ),
    db.query(
      `SELECT
         count(*) FILTER (WHERE status='ACTIVE')::int AS active,
         count(*) FILTER (WHERE status='REVOKED')::int AS revoked,
         count(*) FILTER (WHERE status='EXPIRED')::int AS expired
       FROM "ApiKey"
       WHERE "orgId"=$1`,
      [orgId],
    ),
  ]);

  const row = summary.rows[0] ?? {};
  const requests = Number(row.requests ?? 0);
  const successful = Number(row.successful ?? 0);

  return {
    window,
    summary: {
      requests,
      successful,
      successRate: requests > 0 ? Math.round((successful / requests) * 10000) / 100 : null,
      clientErrors: Number(row.client_errors ?? 0),
      serverErrors: Number(row.server_errors ?? 0),
      rateLimited: Number(row.rate_limited ?? 0),
      avgLatencyMs: Number(row.avg_latency_ms ?? 0),
      p95LatencyMs: Number(row.p95_latency_ms ?? 0),
    },
    credentials: {
      active: Number(keyStates.rows[0]?.active ?? 0),
      revoked: Number(keyStates.rows[0]?.revoked ?? 0),
      expired: Number(keyStates.rows[0]?.expired ?? 0),
    },
    byKey: byKey.rows.map((entry) => ({
      ...entry,
      requests: Number(entry.requests ?? 0),
      successful: Number(entry.successful ?? 0),
      errors: Number(entry.errors ?? 0),
      avgLatencyMs: Number(entry.avgLatencyMs ?? 0),
    })),
    topRoutes: topRoutes.rows.map((entry) => ({
      ...entry,
      requests: Number(entry.requests ?? 0),
      errors: Number(entry.errors ?? 0),
      avgLatencyMs: Number(entry.avgLatencyMs ?? 0),
    })),
    recent: recent.rows.map((entry) => ({
      ...entry,
      statusCode: Number(entry.statusCode ?? 0),
      durationMs: Number(entry.durationMs ?? 0),
      rateLimited: Boolean(entry.rateLimited),
    })),
    quotas: quotas.rows,
    rateLimitPolicy: {
      apiKeyRequestsPerMinute: Number(process.env.API_KEY_RATE_LIMIT_PER_MINUTE ?? 600),
      anonymousIpRequestsPerMinute: Number(process.env.API_IP_RATE_LIMIT_PER_MINUTE ?? 120),
    },
  };
}
