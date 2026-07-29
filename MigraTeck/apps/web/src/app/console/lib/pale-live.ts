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
  deviceCount: number;
};

export type PaleTriage = {
  configured: boolean;
  pending: number | null;
  reviewing: number | null;
  escalated: number | null;
  resolvedToday: number | null;
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
    device_count: string | number;
  }>(
    `SELECT u.id, u.phone_number, u.display_name, u.username, u.account_status,
            u.country_code, (u.age_confirmed_at IS NOT NULL) AS age_ok, u.created_at,
            (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_active,
            (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id) AS device_count
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
    deviceCount: Number(r.device_count) || 0,
  }));
};

/** Trust & Safety triage counts by status (read-only; nulls when not configured). */
export const getPaleTriage = async (): Promise<PaleTriage> => {
  if (!isPaleDbConfigured()) {
    return { configured: false, pending: null, reviewing: null, escalated: null, resolvedToday: null };
  }
  const [pending, reviewing, escalated, resolvedToday] = await Promise.all([
    paleScalar("SELECT count(*)::int v FROM reports WHERE status = 'pending'"),
    paleScalar("SELECT count(*)::int v FROM reports WHERE status = 'reviewing'"),
    paleScalar("SELECT count(*)::int v FROM reports WHERE status = 'escalated'"),
    paleScalar("SELECT count(*)::int v FROM reports WHERE status IN ('reviewed','dismissed','actioned') AND reviewed_at >= date_trunc('day', now())"),
  ]);
  return { configured: true, pending, reviewing, escalated, resolvedToday };
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
export type LiveAuditEvent = {
  createdAt: string | null;
  actor: string;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  status: string | null;
  note: string | null;
  reason: string | null;
  onBehalfOf: string | null;
  requestId: string | null;
};

type RawAuditEventRow = {
  created_at: Date | null; actor_role: string | null; action_type: string;
  target_type: string | null; target_id: string | null; request_id: string | null;
  actor_username: string | null; metadata: Record<string, unknown> | null;
};

const metaStr = (m: Record<string, unknown> | null, k: string): string | null => {
  if (!m || typeof m !== "object") return null;
  const v = m[k];
  return typeof v === "string" ? v : v == null ? null : String(v);
};

const mapAuditEvent = (r: RawAuditEventRow): LiveAuditEvent => ({
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  actor: r.actor_username ?? r.actor_role ?? "system",
  actorRole: r.actor_role,
  action: r.action_type,
  targetType: r.target_type,
  targetId: r.target_id,
  status: metaStr(r.metadata, "status"),
  note: metaStr(r.metadata, "note"),
  reason: metaStr(r.metadata, "reason"),
  onBehalfOf: metaStr(r.metadata, "onBehalfOf"),
  requestId: r.request_id,
});

const AUDIT_EVENT_SELECT =
  `a.created_at, a.actor_role, a.action_type, a.target_type, a.target_id,
   a.request_id, au.username AS actor_username, a.metadata
     FROM audit_logs a
     LEFT JOIN users au ON au.id = a.actor_user_id`;

/** Status/action history for one report (REPORT_* audit events). Read-only. */
export const getReportEvents = async (reportId: string): Promise<LiveAuditEvent[]> => {
  const rows = await paleQuery<RawAuditEventRow>(
    `SELECT ${AUDIT_EVENT_SELECT}
      WHERE a.target_type = 'report' AND a.target_id = $1 AND a.action_type LIKE 'REPORT%'
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [reportId],
  );
  return rows.map(mapAuditEvent);
};

/** Recent moderation activity across reports (REPORT_* audit events). Read-only. */
export const getModerationActivity = async (limit = 20): Promise<LiveAuditEvent[]> => {
  const n = Math.min(Math.max(limit, 1), 100);
  const rows = await paleQuery<RawAuditEventRow>(
    `SELECT ${AUDIT_EVENT_SELECT}
      WHERE a.action_type LIKE 'REPORT%'
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [n],
  );
  return rows.map(mapAuditEvent);
};


// ─── Account controls (read-only) ───────────────────────────────────────────
//
// Reads for the /console/pale/users surface. Mutations (suspend/ban/restore) go
// ONLY through the audited pale-api bridge (lib/pale-admin.ts) — never this pool.
// Phone/email are returned RAW here (server-only) and MUST be masked by the
// caller before rendering (maskPhone / maskEmail / safeAccountName).

/** Valid account statuses (mirrors the AccountStatus enum). */
export const ACCOUNT_STATUSES = [
  "active", "suspended", "banned", "deactivated",
] as const;

export type ManagedUser = {
  id: string;
  phone: string | null;
  name: string | null;
  username: string | null;
  email: string | null;
  status: string;
  roles: string[];
  country: string | null;
  createdAt: string | null;
  lastActive: string | null;
};

export type AccountFilters = {
  status?: string;
  role?: string;
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
};

type RawManagedUser = {
  id: string; phone_number: string | null; display_name: string | null;
  username: string | null; email: string | null; account_status: string;
  country_code: string | null;
  created_at: Date | null; last_active: Date | null;
};

const mapManagedUser = (r: RawManagedUser, roles: string[] = []): ManagedUser => ({
  id: r.id,
  phone: r.phone_number,
  name: r.display_name,
  username: r.username,
  email: r.email,
  status: r.account_status,
  roles,
  country: r.country_code,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  lastActive: r.last_active ? new Date(r.last_active).toISOString() : null,
});

// NOTE: roles are fetched SEPARATELY (fetchRolesByUserId), not joined here. The
// least-privilege read-only role may lack SELECT on user_roles/roles; keeping that
// join in the main query made the whole accounts query fail ("permission denied for
// table user_roles") → empty list. Splitting it lets the list/detail render and
// roles degrade to empty when not granted.
const MANAGED_USER_SELECT =
  `u.id, u.phone_number, u.display_name, u.username, u.email,
   u.account_status::text AS account_status, u.country_code, u.created_at,
   (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_active
     FROM users u`;

/**
 * Best-effort role lookup for a set of user ids. Returns empty roles (never
 * throws / never fails the caller) when the read-only role can't read
 * user_roles/roles — paleQuery swallows the error and returns [].
 */
const fetchRolesByUserId = async (ids: string[]): Promise<Map<string, string[]>> => {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const rows = await paleQuery<{ user_id: string; roles: string[] | null }>(
    `SELECT ur.user_id, array_agg(ro.key::text) AS roles
       FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
      WHERE ur.revoked_at IS NULL AND ur.user_id IN (${placeholders})
      GROUP BY ur.user_id`,
    ids,
  );
  for (const r of rows) {
    map.set(r.user_id, Array.isArray(r.roles) ? r.roles.filter(Boolean) : []);
  }
  return map;
};

/** Filtered, masked-at-display account list for the management surface. */
export const getPaleAccounts = async (opts: AccountFilters = {}): Promise<ManagedUser[]> => {
  const where: string[] = ["u.deleted_at IS NULL"];
  const params: Array<string | number> = [];
  if (opts.status && (ACCOUNT_STATUSES as readonly string[]).includes(opts.status)) {
    params.push(opts.status);
    where.push(`u.account_status::text = $${params.length}`);
  }
  if (opts.role) {
    params.push(opts.role);
    where.push(
      `EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
                WHERE ur.user_id = u.id AND ur.revoked_at IS NULL AND ro.key::text = $${params.length})`,
    );
  }
  if (opts.query && opts.query.trim()) {
    params.push(`%${opts.query.trim()}%`);
    const i = params.length;
    where.push(
      `(u.username ILIKE $${i} OR u.display_name ILIKE $${i} OR u.phone_number ILIKE $${i} OR u.email ILIKE $${i})`,
    );
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`u.created_at >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`u.created_at <= $${params.length}`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  params.push(limit);
  const rows = await paleQuery<RawManagedUser>(
    `SELECT ${MANAGED_USER_SELECT}
      WHERE ${where.join(" AND ")}
      ORDER BY u.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  const roleMap = await fetchRolesByUserId(rows.map((r) => r.id));
  return rows.map((r) => mapManagedUser(r, roleMap.get(r.id) ?? []));
};

/** Single account by id (read-only) for the detail view. */
export const getPaleAccount = async (id: string): Promise<ManagedUser | null> => {
  const rows = await paleQuery<RawManagedUser>(
    `SELECT ${MANAGED_USER_SELECT}
      WHERE u.id = $1
      LIMIT 1`,
    [id],
  );
  if (!rows[0]) return null;
  const roleMap = await fetchRolesByUserId([rows[0].id]);
  return mapManagedUser(rows[0], roleMap.get(rows[0].id) ?? []);
};

/** Account-status history for one user (USER_* audit events). Read-only. */
export const getPaleUserAuditEvents = async (userId: string): Promise<LiveAuditEvent[]> => {
  const rows = await paleQuery<RawAuditEventRow>(
    `SELECT ${AUDIT_EVENT_SELECT}
      WHERE a.target_type = 'user' AND a.target_id = $1 AND a.action_type LIKE 'USER%'
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [userId],
  );
  return rows.map(mapAuditEvent);
};

/** Account-status counts by status (real; 0 when none). Read-only. */
export const getAccountStatusCounts = async (): Promise<Record<string, number>> => {
  const rows = await paleQuery<{ status: string; c: string | number }>(
    `SELECT account_status::text AS status, count(*)::int c
       FROM users WHERE deleted_at IS NULL GROUP BY account_status`,
  );
  const out: Record<string, number> = {};
  for (const s of ACCOUNT_STATUSES) out[s] = 0;
  for (const r of rows) out[r.status] = Number(r.c) || 0;
  return out;
};
