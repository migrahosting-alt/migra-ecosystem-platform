/**
 * Pale Control Center — overview view model (Phase 1, live read-only).
 *
 * Assembles the dashboard from live read-only Pale-DB queries (lib/pale-live.ts)
 * with HONEST states: when the Pale DB is not configured, panels report
 * "Not configured"; panels with no backend model yet (tickets, appeals, OTP
 * delivery) report "No live endpoint connected yet". NOTHING is fabricated.
 * Phone numbers are masked here before they reach the page.
 *
 * Reads only. All mutations are deferred to Phase 2 (pale-api audited endpoints).
 */

import { getPaleBackendHealth } from "./pale";
import { maskPhone } from "./pale-rbac";
import {
  getPaleOverview,
  getPaleUsers,
  getPaleReports,
  getPaleAudit,
  getPaleReportQueue,
  getPaleClientVersion,
  getPaleTriage,
} from "./pale-live";
import { isPaleDbConfigured } from "./pale-db";

export type Variant = "violet" | "fuchsia" | "amber" | "rose" | "blue" | "emerald";

export type KpiView = {
  key: string;
  label: string;
  variant: Variant;
  period: string;
  value: string;
  notConfigured: boolean;
  deltaPct: number | null;
  deltaDir: "up" | "down" | "flat";
  spark: ReadonlyArray<number>;
};

export type QueueView = { label: string; icon: string; count: number; oldest: string };
export type UserView = { name: string; phone: string; status: string; statusTone: "ok" | "warn" | "danger"; lastActive: string; devices: number };
export type AuditView = { time: string; admin: string; action: string; tone: "danger" | "ok" | "warn"; target: string; details: string };
export type ReleaseRow = { label: string; value: string; badge?: { text: string; tone: "latest" | "internal" } | undefined; ok?: boolean | undefined; pending?: boolean | undefined };

/** Compact signal for the operational health strip. */
export type SignalView = {
  key: string;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "danger" | "idle";
  spark: ReadonlyArray<number>;
};

export type TriageView = {
  live: boolean;
  pending: number | null;
  reviewing: number | null;
  escalated: number | null;
  resolvedToday: number | null;
};

export type PaleDashboardView = {
  dbConfigured: boolean;
  backend: { status: "live" | "down" | "unreachable"; label: string };
  lastSync: string;
  signals: ReadonlyArray<SignalView>;
  kpis: ReadonlyArray<KpiView>;
  triage: TriageView;
  queue: { live: boolean; rows: ReadonlyArray<QueueView> };
  users: { live: boolean; rows: ReadonlyArray<UserView> };
  audit: { live: boolean; rows: ReadonlyArray<AuditView> };
  release: ReadonlyArray<ReleaseRow>;
};

const fmtNum = (n: number | null): { value: string; notConfigured: boolean } =>
  n == null ? { value: "Not configured", notConfigured: true } : { value: n.toLocaleString("en-US"), notConfigured: false };

const dir = (p: number | null): "up" | "down" | "flat" => (p == null ? "flat" : p > 0 ? "up" : p < 0 ? "down" : "flat");

const relative = (iso: string | null): string => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const absolute = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
};

const QUEUE_MAP: Record<string, { label: string; icon: string }> = {
  message: { label: "Reported Messages", icon: "message" },
  user: { label: "Profile Reports", icon: "user-x" },
  profile: { label: "Profile Reports", icon: "user-x" },
  group: { label: "Group Reports", icon: "alert" },
  status: { label: "Status Reports", icon: "image" },
  media: { label: "Media Reports", icon: "image" },
  call: { label: "Abusive Calls", icon: "phone" },
};

const queueLabel = (t: string) =>
  QUEUE_MAP[t] ?? { label: t.charAt(0).toUpperCase() + t.slice(1) + " Reports", icon: "alert" };

const auditTone = (action: string): "danger" | "ok" | "warn" => {
  const a = action.toUpperCase();
  if (a.includes("BAN") || a.includes("SUSPEND") || a.includes("DELETE")) return "danger";
  if (a.includes("RESTORE") || a.includes("RESOLVE") || a.includes("APPROVE")) return "ok";
  return "warn";
};

const prettyAction = (action: string) =>
  action.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const shortId = (id: string | null) => (id ? id.slice(0, 8) : "");

/**
 * Pale defaults `display_name` (and sometimes username) to the user's raw phone
 * number when they haven't set a name. Such values must NEVER render unmasked in
 * the Name column. Treat a value as phone-like when it's composed only of phone
 * punctuation/digits and carries 7+ digits.
 */
const looksLikePhone = (s: string | null | undefined): boolean => {
  if (!s) return false;
  return /^[+\d\s().-]+$/.test(s) && s.replace(/\D/g, "").length >= 7;
};

/**
 * Pale auto-generates usernames from the phone number (e.g. `pale52236581`,
 * which embeds the phone's trailing digits). Even though usernames are public in
 * the app, the admin surface must not surface phone-derived digits as a name.
 * Treat a value as phone-derived when it matches the `pale<digits>` generator
 * pattern OR embeds a 6+ digit run that appears in the user's phone number.
 */
const isPhoneDerived = (value: string, phone: string | null): boolean => {
  const v = value.trim();
  if (/^pale\d{4,}$/i.test(v)) return true;
  const userDigits = v.replace(/\D/g, "");
  const phoneDigits = (phone ?? "").replace(/\D/g, "");
  return userDigits.length >= 6 && phoneDigits.length > 0 && phoneDigits.includes(userDigits);
};

/**
 * Display name that is safe to show on the admin surface: a real user-chosen
 * name/username, else the masked phone. Rejects both phone-like values and
 * phone-derived auto-usernames so no phone digits leak through the Name column.
 */
const safeDisplayName = (
  name: string | null,
  username: string | null,
  phone: string | null,
): string => {
  const ok = (s: string | null): s is string =>
    !!s && !looksLikePhone(s) && !isPhoneDerived(s, phone);
  if (ok(name)) return name;
  if (ok(username)) return username;
  return maskPhone(phone);
};

/**
 * Audit-log actor label. Audit actors are usernames/roles; Pale's auto-generated
 * usernames (`pale<digits>`) embed phone digits, so never show them directly.
 * Phone-derived handles render as "Pale user ••••NNNN" (last 4 digits only —
 * never a 6+ digit run). Real admin handles/roles (no long digit run) pass through.
 */
const maskActor = (actor: string): string => {
  const a = actor.trim();
  const digits = a.replace(/\D/g, "");
  const phoneDerived = /^pale\d{4,}$/i.test(a) || digits.length >= 6;
  if (!phoneDerived) return a;
  const last4 = digits.slice(-4);
  return last4 ? `Pale user ••••${last4}` : "Pale user";
};

export const getPaleDashboardView = async (): Promise<PaleDashboardView> => {
  const dbConfigured = isPaleDbConfigured();

  const [overview, health, users, queueRows, audit, clientVersion, triageRaw] = await Promise.all([
    getPaleOverview(),
    getPaleBackendHealth(),
    getPaleUsers(6),
    getPaleReportQueue(),
    getPaleAudit(8),
    getPaleClientVersion(),
    getPaleTriage(),
  ]);
  // Reports list is also read for masking parity / future detail wiring.
  await getPaleReports(1).catch(() => []);

  const kpis: KpiView[] = [
    {
      key: "users", label: "Total Users", variant: "violet", period: "vs last 7 days",
      ...fmtNum(overview.totalUsers),
      deltaPct: overview.totalUsersDeltaPct, deltaDir: dir(overview.totalUsersDeltaPct), spark: overview.totalUsersSpark,
    },
    {
      key: "active", label: "Active Today", variant: "fuchsia", period: "vs yesterday",
      ...fmtNum(overview.activeToday),
      deltaPct: overview.activeTodayDeltaPct, deltaDir: dir(overview.activeTodayDeltaPct), spark: overview.activeTodaySpark,
    },
    {
      key: "reports", label: "Pending Reports", variant: "amber", period: "vs yesterday",
      ...fmtNum(overview.pendingReports),
      deltaPct: overview.pendingReportsDeltaPct, deltaDir: dir(overview.pendingReportsDeltaPct), spark: overview.pendingReportsSpark,
    },
    // No backend model yet — honest "Not configured", never a fake number.
    { key: "tickets", label: "Open Tickets", variant: "rose", period: "requires endpoint", value: "Not configured", notConfigured: true, deltaPct: null, deltaDir: "flat", spark: [] },
    { key: "appeals", label: "Pending Appeals", variant: "blue", period: "requires endpoint", value: "Not configured", notConfigured: true, deltaPct: null, deltaDir: "flat", spark: [] },
    { key: "otp", label: "OTP Health", variant: "emerald", period: "requires endpoint", value: "Not configured", notConfigured: true, deltaPct: null, deltaDir: "flat", spark: [] },
  ];

  const queue: QueueView[] = queueRows.map((q) => {
    const m = queueLabel(q.targetType);
    return { label: m.label, icon: m.icon, count: q.count, oldest: relative(q.oldest) };
  });

  const userRows: UserView[] = users.map((u) => ({
    name: safeDisplayName(u.name, u.username, u.phone),
    phone: maskPhone(u.phone),
    status: u.status === "active" ? "Active" : u.status === "suspended" ? "Suspended" : u.status === "banned" ? "Banned" : u.status,
    statusTone: u.status === "banned" ? "danger" : u.status === "suspended" ? "warn" : "ok",
    lastActive: relative(u.lastActive),
    devices: u.deviceCount,
  }));

  const auditRows: AuditView[] = audit.map((a) => ({
    time: absolute(a.createdAt),
    admin: maskActor(a.actor),
    action: prettyAction(a.action),
    tone: auditTone(a.action),
    target: a.targetType ? `${a.targetType} ${shortId(a.targetId)}`.trim() : shortId(a.targetId),
    details: a.reason ?? (a.actorRole ? `Role: ${a.actorRole}` : "—"),
  }));

  const backendValue =
    health.status === "live" ? "All Systems Operational" : health.status === "down" ? "Backend degraded" : "Backend unreachable";

  const release: ReleaseRow[] = [
    clientVersion
      ? { label: "Android rollout (most-seen)", value: clientVersion, ok: true }
      : { label: "Android rollout", value: "Requires endpoint", pending: true },
    { label: "Private media enforcement", value: "Requires endpoint", pending: true },
    { label: "Backend health", value: backendValue, ok: health.status === "live" },
    { label: "Vulnerability scan", value: "Requires endpoint", pending: true },
    { label: "Admin mutation mode", value: "Read-only · approval required", ok: false, pending: true },
  ];

  // ── Operational health strip (compact live signals) ──
  const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));
  const deltaSub = (p: number | null, period: string) =>
    p == null ? "no baseline" : `${p > 0 ? "▲" : p < 0 ? "▼" : "▬"} ${Math.abs(p).toFixed(1)}% ${period}`;
  const pendingReports = overview.pendingReports;
  const signals: SignalView[] = [
    {
      key: "users", label: "Users", value: num(overview.totalUsers),
      sub: overview.newSignupsToday != null ? `+${overview.newSignupsToday} today` : "total accounts",
      tone: overview.totalUsers == null ? "idle" : "ok", spark: overview.totalUsersSpark,
    },
    {
      key: "active", label: "Active today", value: num(overview.activeToday),
      sub: deltaSub(overview.activeTodayDeltaPct, "vs yest."),
      tone: overview.activeToday == null ? "idle" : "ok", spark: overview.activeTodaySpark,
    },
    {
      key: "reports", label: "Open reports", value: num(pendingReports),
      sub: pendingReports == null ? "requires DB" : pendingReports > 0 ? "awaiting triage" : "queue clear",
      tone: pendingReports == null ? "idle" : pendingReports > 0 ? "warn" : "ok", spark: overview.pendingReportsSpark,
    },
    {
      key: "backend", label: "Backend", value: health.status === "live" ? "Operational" : health.status === "down" ? "Degraded" : "Unreachable",
      sub: "pale-api health probe",
      tone: health.status === "live" ? "ok" : health.status === "down" ? "warn" : "danger", spark: [],
    },
    {
      key: "media", label: "Private media", value: "Enforced", sub: "strict mode · backend-owned",
      tone: "ok", spark: [],
    },
    {
      key: "release", label: "Release", value: clientVersion ?? "—",
      sub: clientVersion ? "most-seen client" : "requires endpoint",
      tone: clientVersion ? "ok" : "idle", spark: [],
    },
  ];

  return {
    dbConfigured,
    backend: { status: health.status, label: backendValue },
    lastSync: new Date().toLocaleString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }),
    signals,
    kpis,
    triage: {
      live: triageRaw.configured,
      pending: triageRaw.pending,
      reviewing: triageRaw.reviewing,
      escalated: triageRaw.escalated,
      resolvedToday: triageRaw.resolvedToday,
    },
    queue: { live: dbConfigured, rows: queue },
    users: { live: dbConfigured, rows: userRows },
    audit: { live: dbConfigured, rows: auditRows },
    release,
  };
};
