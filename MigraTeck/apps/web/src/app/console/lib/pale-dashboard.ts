/**
 * Pale Control Center — overview dashboard data.
 *
 * This drives the `/console/pale` overview exactly as designed in the approved
 * mockup. It is the SINGLE data source for the page, so each section can be
 * swapped from sample → live pale-api data independently once the Phase-0 staff
 * auth bridge + `/v1/admin/*` wiring land (see the Pale Control Center blueprint).
 *
 * HONESTY: every value below is **sample/draft data** matching the mockup, EXCEPT
 * `release.backendHealth`, which is a real live probe of pale-api. Phone numbers
 * are masked (as in the mockup) and no OTP codes / tokens are ever present.
 * Replace the SAMPLE_* constants with live admin-API reads section by section.
 */

import { getPaleBackendHealth } from "./pale";

/* --------------------------------------------------------------- KPI row (6) */

export type PaleKpi = {
  key: string;
  label: string;
  value: string;
  deltaPct: number;
  deltaDir: "up" | "down" | "flat";
  period: string;
  variant: "violet" | "fuchsia" | "amber" | "rose" | "blue" | "emerald";
  spark: ReadonlyArray<number>;
};

const SAMPLE_KPIS: ReadonlyArray<PaleKpi> = [
  { key: "users", label: "Total Users", value: "128,452", deltaPct: 6.8, deltaDir: "up", period: "vs last 7 days", variant: "violet", spark: [42, 45, 44, 48, 51, 50, 55, 58, 60, 63] },
  { key: "active", label: "Active Today", value: "18,746", deltaPct: 7.4, deltaDir: "up", period: "vs yesterday", variant: "fuchsia", spark: [30, 34, 31, 38, 42, 40, 47, 44, 52, 56] },
  { key: "reports", label: "Pending Reports", value: "312", deltaPct: 12.3, deltaDir: "up", period: "vs yesterday", variant: "amber", spark: [20, 24, 22, 28, 26, 32, 30, 36, 34, 40] },
  { key: "tickets", label: "Open Tickets", value: "156", deltaPct: 4.1, deltaDir: "up", period: "vs yesterday", variant: "rose", spark: [48, 44, 46, 42, 45, 41, 44, 40, 43, 45] },
  { key: "appeals", label: "Pending Appeals", value: "48", deltaPct: 9.1, deltaDir: "up", period: "vs yesterday", variant: "blue", spark: [18, 20, 19, 23, 21, 25, 24, 28, 30, 33] },
  { key: "otp", label: "OTP Health", value: "99.42%", deltaPct: 0.6, deltaDir: "up", period: "vs yesterday", variant: "emerald", spark: [60, 58, 61, 59, 62, 60, 63, 61, 64, 65] },
];

/* ----------------------------------------------- 1. Trust & Safety queue */

export type QueueRow = { type: string; icon: string; count: number; priority: "High" | "Medium" | "Reviewing"; oldest: string };

const SAMPLE_QUEUE: ReadonlyArray<QueueRow> = [
  { type: "Reported Messages", icon: "message", count: 98, priority: "High", oldest: "2h ago" },
  { type: "Harassment", icon: "alert", count: 64, priority: "High", oldest: "1h ago" },
  { type: "Impersonation", icon: "user-x", count: 42, priority: "Medium", oldest: "4h ago" },
  { type: "Spam / Scam", icon: "ban", count: 57, priority: "Medium", oldest: "3h ago" },
  { type: "Abusive Calls", icon: "phone", count: 21, priority: "High", oldest: "1h ago" },
  { type: "Status / Media Reports", icon: "image", count: 30, priority: "Reviewing", oldest: "6h ago" },
];

/* ------------------------------------------------------- 2. Support tickets */

export type TicketRow = { subject: string; user: string; status: "Open" | "Pending"; updated: string };

const SAMPLE_TICKETS: ReadonlyArray<TicketRow> = [
  { subject: "OTP not received", user: "+234 803 **** 1122", status: "Open", updated: "10m ago" },
  { subject: "Login issue", user: "+91 98765 **** 21", status: "Open", updated: "23m ago" },
  { subject: "Delete account request", user: "+1 415 **** 6677", status: "Pending", updated: "41m ago" },
  { subject: "Account recovery", user: "+234 902 **** 7788", status: "Open", updated: "1h ago" },
  { subject: "Blocked account appeal", user: "+254 712 **** 334", status: "Pending", updated: "2h ago" },
];

/* ------------------------------------------------------------ 3. User control */

export type UserRow = { name: string; phone: string; status: "Active" | "Suspended"; lastActive: string };

const SAMPLE_USERS: ReadonlyArray<UserRow> = [
  { name: "Jane Doe", phone: "+1 415 **** 6677", status: "Active", lastActive: "2m ago" },
  { name: "Ahmed Bello", phone: "+234 803 **** 1122", status: "Active", lastActive: "5m ago" },
  { name: "Priya Sharma", phone: "+91 98765 **** 21", status: "Active", lastActive: "12m ago" },
  { name: "Carlos Mendez", phone: "+52 55 **** 8899", status: "Suspended", lastActive: "1d ago" },
  { name: "Fatima Ali", phone: "+971 50 **** 4433", status: "Active", lastActive: "1h ago" },
];

/* --------------------------------------------------------- 4. Appeals & claims */

export type AppealRow = { type: string; user: string; status: "Under Review" | "Pending Info"; updated: string };

const SAMPLE_APPEALS: ReadonlyArray<AppealRow> = [
  { type: "Ban appeal", user: "+234 701 **** 8890", status: "Under Review", updated: "2h ago" },
  { type: "Ownership claim", user: "+1 206 **** 7789", status: "Pending Info", updated: "5h ago" },
  { type: "Content restoration", user: "+91 91234 **** 56", status: "Under Review", updated: "6h ago" },
  { type: "Phone ownership issue", user: "+44 7700 **** 123", status: "Pending Info", updated: "1d ago" },
];

/* ------------------------------------------------------------ 5. OTP delivery */

export type OtpRouteRow = { route: string; region: string; successRate: string; latency: string; status: "Healthy" | "Degraded" | "Down" };

const SAMPLE_OTP_ROUTES: ReadonlyArray<OtpRouteRow> = [
  { route: "SMS", region: "Global", successRate: "98.67%", latency: "1.25s", status: "Healthy" },
  { route: "Voice Fallback", region: "Global", successRate: "96.31%", latency: "2.84s", status: "Healthy" },
  { route: "WhatsApp OTP", region: "Global", successRate: "97.89%", latency: "1.63s", status: "Healthy" },
];

/* ----------------------------------------------- 6. Release & security status */

export type ReleaseRow = { label: string; value: string; badge?: { text: string; tone: "latest" | "internal" } | undefined; ok?: boolean | undefined };

/* ------------------------------------------------------------- 7. Audit log */

export type AuditRow = { time: string; admin: string; action: string; actionTone: "danger" | "ok" | "warn"; target: string; details: string };

const SAMPLE_AUDIT: ReadonlyArray<AuditRow> = [
  { time: "May 12, 2025 10:42 AM", admin: "admin", action: "Suspended user", actionTone: "danger", target: "Carlos Mendez (+52 55 **** 8899)", details: "Reason: Policy violation – Spam" },
  { time: "May 12, 2025 10:31 AM", admin: "safety.officer", action: "Resolved report", actionTone: "ok", target: "Report #R-89231", details: "Type: Harassment · Status: No violation" },
  { time: "May 12, 2025 10:15 AM", admin: "support.lead", action: "Restored account", actionTone: "ok", target: "Aisha Khan (+971 50 **** 4433)", details: "Appeal approved" },
  { time: "May 12, 2025 09:58 AM", admin: "review.team", action: "Reviewed appeal", actionTone: "warn", target: "Ban appeal – +234 701 **** 8890", details: "Decision: Upheld" },
];

export type PaleDashboard = {
  kpis: ReadonlyArray<PaleKpi>;
  queue: ReadonlyArray<QueueRow>;
  tickets: ReadonlyArray<TicketRow>;
  users: ReadonlyArray<UserRow>;
  appeals: ReadonlyArray<AppealRow>;
  otpRoutes: ReadonlyArray<OtpRouteRow>;
  release: ReadonlyArray<ReleaseRow>;
  audit: ReadonlyArray<AuditRow>;
};

/**
 * Build the dashboard. All sample sections are static; `release.backendHealth`
 * is resolved from a live pale-api probe so at least one row is always truthful.
 */
export const getPaleDashboard = async (): Promise<PaleDashboard> => {
  const health = await getPaleBackendHealth();
  const backendValue =
    health.status === "live"
      ? "All Systems Operational"
      : health.status === "down"
        ? "Backend degraded"
        : "Backend unreachable";
  const backendOk = health.status === "live";

  const release: ReadonlyArray<ReleaseRow> = [
    { label: "Android App Version", value: "v1.8.3 (458)", badge: { text: "Latest", tone: "latest" } },
    { label: "Play Internal Testing", value: "v1.9.0-beta.2 (512)", badge: { text: "Internal", tone: "internal" } },
    { label: "Private Media Enforcement", value: "Enabled", ok: true },
    { label: "Backend Health", value: backendValue, ok: backendOk },
    { label: "Last Release", value: "May 11, 2025 · 10:21 AM" },
    { label: "Vulnerability Scan", value: "No critical issues", ok: true },
  ];

  return {
    kpis: SAMPLE_KPIS,
    queue: SAMPLE_QUEUE,
    tickets: SAMPLE_TICKETS,
    users: SAMPLE_USERS,
    appeals: SAMPLE_APPEALS,
    otpRoutes: SAMPLE_OTP_ROUTES,
    release,
    audit: SAMPLE_AUDIT,
  };
};
