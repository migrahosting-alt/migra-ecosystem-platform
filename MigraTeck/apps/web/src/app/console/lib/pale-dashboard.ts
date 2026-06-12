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
export type UserView = { name: string; phone: string; status: string; lastActive: string };
export type AuditView = { time: string; admin: string; action: string; tone: "danger" | "ok" | "warn"; target: string; details: string };
export type ReleaseRow = { label: string; value: string; badge?: { text: string; tone: "latest" | "internal" } | undefined; ok?: boolean | undefined; pending?: boolean | undefined };

export type PaleDashboardView = {
  dbConfigured: boolean;
  kpis: ReadonlyArray<KpiView>;
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

export const getPaleDashboardView = async (): Promise<PaleDashboardView> => {
  const dbConfigured = isPaleDbConfigured();

  const [overview, health, users, queueRows, audit, clientVersion] = await Promise.all([
    getPaleOverview(),
    getPaleBackendHealth(),
    getPaleUsers(8),
    getPaleReportQueue(),
    getPaleAudit(8),
    getPaleClientVersion(),
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
    name: u.name || u.username || "—",
    phone: maskPhone(u.phone),
    status: u.status === "active" ? "Active" : u.status === "suspended" ? "Suspended" : u.status === "banned" ? "Banned" : u.status,
    lastActive: relative(u.lastActive),
  }));

  const auditRows: AuditView[] = audit.map((a) => ({
    time: absolute(a.createdAt),
    admin: a.actor,
    action: prettyAction(a.action),
    tone: auditTone(a.action),
    target: a.targetType ? `${a.targetType} ${shortId(a.targetId)}`.trim() : shortId(a.targetId),
    details: a.reason ?? (a.actorRole ? `Role: ${a.actorRole}` : "—"),
  }));

  const backendValue =
    health.status === "live" ? "All Systems Operational" : health.status === "down" ? "Backend degraded" : "Backend unreachable";

  const release: ReleaseRow[] = [
    clientVersion
      ? { label: "Most-seen Android Version", value: clientVersion, ok: true }
      : { label: "Android App Version", value: "Requires endpoint", pending: true },
    { label: "Play Internal Testing", value: "Requires endpoint", pending: true },
    { label: "Private Media Enforcement", value: "Requires endpoint", pending: true },
    { label: "Backend Health", value: backendValue, ok: health.status === "live" },
    { label: "Last Release", value: "Requires endpoint", pending: true },
    { label: "Vulnerability Scan", value: "Requires endpoint", pending: true },
  ];

  return {
    dbConfigured,
    kpis,
    queue: { live: dbConfigured, rows: queue },
    users: { live: dbConfigured, rows: userRows },
    audit: { live: dbConfigured, rows: auditRows },
    release,
  };
};
