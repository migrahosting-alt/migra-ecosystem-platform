/**
 * Pale Control Center — live read-only queries.
 *
 * Every function reads the Pale DB through the read-only pool (lib/pale-db.ts)
 * and returns plain data or null/[] when not configured. No writes, ever. No
 * fabricated values: if the DB is not configured, callers render "Not configured".
 *
 * Privacy: phone numbers are returned RAW here (server-only) and MUST be masked
 * by the caller before rendering. Never select OTP codes, token hashes, or
 * private media URLs into these projections.
 */

import { paleQuery, paleScalar, isPaleDbConfigured } from "./pale-db";

export type LiveUser = {
  id: string;
  phone: string | null;
  name: string | null;
  username: string | null;
  status: string;
  country: string | null;
  ageOk: boolean;
  createdAt: string | null;
  lastActive: string | null;
};

export type LiveReport = {
  id: string;
  targetType: string;
  reason: string;
  status: string;
  reporterPhone: string | null;
  createdAt: string | null;
};

export type LiveAudit = {
  createdAt: string | null;
  actor: string;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
};

export type PaleOverview = {
  totalUsers: number | null;
  totalUsersDeltaPct: number | null;
  totalUsersSpark: ReadonlyArray<number>;
  activeToday: number | null;
  activeTodayDeltaPct: number | null;
  activeTodaySpark: ReadonlyArray<number>;
  pendingReports: number | null;
  pendingReportsDeltaPct: number | null;
  pendingReportsSpark: ReadonlyArray<number>;
  bannedSuspended: number | null;
  newSignupsToday: number | null;
};

const pct = (now: number | null, prev: number | null): number | null => {
  if (now == null || prev == null || prev === 0) return null;
  return ((now - prev) / prev) * 100;
};

const seriesValues = async (sql: string): Promise<number[]> => {
  const rows = await paleQuery<{ c: string | number }>(sql);
  return rows.map((r) => Number(r.c)).filter((n) => Number.isFinite(n));
};

export const getPaleOverview = async (): Promise<PaleOverview> => {
  if (!isPaleDbConfigured()) {
    return {
      totalUsers: null, totalUsersDeltaPct: null, totalUsersSpark: [],
      activeToday: null, activeTodayDeltaPct: null, activeTodaySpark: [],
      pendingReports: null, pendingReportsDeltaPct: null, pendingReportsSpark: [],
      bannedSuspended: null, newSignupsToday: null,
    };
  }

  const [
    totalUsers, totalUsersPrev,
    activeToday, activeYesterday,
    pendingReports, reports24h, reportsPrev24h,
    bannedSuspended, newSignupsToday,
    usersSpark, activeSpark, reportsSpark,
  ] = await Promise.all([
    paleScalar("SELECT count(*)::int v FROM users WHERE deleted_at IS NULL"),
    paleScalar("SELECT count(*)::int v FROM users WHERE deleted_at IS NULL AND created_at < now() - interval '7 days'"),
    paleScalar("SELECT count(DISTINCT user_id)::int v FROM sessions WHERE revoked_at IS NULL AND last_seen_at >= now() - interval '24 hours'"),
    paleScalar("SELECT count(DISTINCT user_id)::int v FROM sessions WHERE last_seen_at >= now() - interval '48 hours' AND last_seen_at < now() - interval '24 hours'"),
    paleScalar("SELECT count(*)::int v FROM reports WHERE status = 'pending'"),
    paleScalar("SELECT count(*)::int v FROM reports WHERE created_at >= now() - interval '24 hours'"),
    paleScalar("SELECT count(*)::int v FROM reports WHERE created_at >= now() - interval '48 hours' AND created_at < now() - interval '24 hours'"),
    paleScalar("SELECT count(*)::int v FROM users WHERE account_status IN ('banned','suspended')"),
    paleScalar("SELECT count(*)::int v FROM users WHERE created_at >= date_trunc('day', now())"),
    seriesValues("SELECT count(*)::int c FROM users WHERE created_at >= now() - interval '7 days' GROUP BY date_trunc('day', created_at) ORDER BY date_trunc('day', created_at)"),
    seriesValues("SELECT count(DISTINCT user_id)::int c FROM sessions WHERE last_seen_at >= now() - interval '7 days' GROUP BY date_trunc('day', last_seen_at) ORDER BY date_trunc('day', last_seen_at)"),
    seriesValues("SELECT count(*)::int c FROM reports WHERE created_at >= now() - interval '7 days' GROUP BY date_trunc('day', created_at) ORDER BY date_trunc('day', created_at)"),
  ]);

  return {
    totalUsers,
    totalUsersDeltaPct: pct(totalUsers, totalUsersPrev),
    totalUsersSpark: usersSpark,
    activeToday,
    activeTodayDeltaPct: pct(activeToday, activeYesterday),
    activeTodaySpark: activeSpark,
    pendingReports,
    pendingReportsDeltaPct: pct(reports24h, reportsPrev24h),
    pendingReportsSpark: reportsSpark,
    bannedSuspended,
    newSignupsToday,
  };
};

export const getPaleUsers = async (limit = 8): Promise<LiveUser[]> => {
  const rows = await paleQuery<{
    id: string; phone_number: string | null; display_name: string | null;
    username: string | null; account_status: string; country_code: string | null;
    age_ok: boolean; created_at: Date | null; last_active: Date | null;
  }>(
    `SELECT u.id, u.phone_number, u.display_name, u.username, u.account_status,
            u.country_code, (u.age_confirmed_at IS NOT NULL) AS age_ok, u.created_at,
            (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_active
       FROM users u
      WHERE u.deleted_at IS NULL
      ORDER BY u.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    phone: r.phone_number,
    name: r.display_name,
    username: r.username,
    status: r.account_status,
    country: r.country_code,
    ageOk: Boolean(r.age_ok),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    lastActive: r.last_active ? new Date(r.last_active).toISOString() : null,
  }));
};

export const getPaleReports = async (limit = 8): Promise<LiveReport[]> => {
  const rows = await paleQuery<{
    id: string; target_type: string; reason: string; status: string;
    reporter_phone: string | null; created_at: Date | null;
  }>(
    `SELECT r.id, r.target_type, r.reason, r.status, ru.phone_number AS reporter_phone, r.created_at
       FROM reports r
       LEFT JOIN users ru ON ru.id = r.reporter_id
      ORDER BY r.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    reason: r.reason,
    status: r.status,
    reporterPhone: r.reporter_phone,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));
};

export type LiveQueueRow = { targetType: string; count: number; oldest: string | null };

/** Open report queue aggregated by target type (real; no invented priority). */
export const getPaleReportQueue = async (): Promise<LiveQueueRow[]> => {
  const rows = await paleQuery<{ target_type: string; c: string | number; oldest: Date | null }>(
    `SELECT target_type, count(*)::int c, min(created_at) AS oldest
       FROM reports
      WHERE status IN ('pending','reviewing')
      GROUP BY target_type
      ORDER BY c DESC
      LIMIT 8`,
  );
  return rows.map((r) => ({
    targetType: r.target_type,
    count: Number(r.c),
    oldest: r.oldest ? new Date(r.oldest).toISOString() : null,
  }));
};

/** Most-common Android client version currently seen (real, from devices). */
export const getPaleClientVersion = async (): Promise<string | null> => {
  const rows = await paleQuery<{ app_version: string }>(
    `SELECT app_version
       FROM devices
      WHERE app_version IS NOT NULL AND platform = 'android'
      GROUP BY app_version
      ORDER BY count(*) DESC
      LIMIT 1`,
  );
  return rows[0]?.app_version ?? null;
};

export const getPaleAudit = async (limit = 8): Promise<LiveAudit[]> => {
  const rows = await paleQuery<{
    created_at: Date | null; actor_role: string | null; action_type: string;
    target_type: string | null; target_id: string | null;
    actor_username: string | null; metadata: Record<string, unknown> | null;
  }>(
    `SELECT a.created_at, a.actor_role, a.action_type, a.target_type, a.target_id,
            au.username AS actor_username, a.metadata
       FROM audit_logs a
       LEFT JOIN users au ON au.id = a.actor_user_id
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => {
    const reason = r.metadata && typeof r.metadata === "object"
      ? ((r.metadata as Record<string, unknown>)["reason"] as string | undefined)
      : undefined;
    return {
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      actor: r.actor_username ?? r.actor_role ?? "system",
      actorRole: r.actor_role,
      action: r.action_type,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: reason ?? null,
    };
  });
};
