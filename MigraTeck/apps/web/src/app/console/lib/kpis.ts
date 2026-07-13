import { panelQuery, isPanelDbConfigured } from "./db";

export type Kpi = {
  label: string;
  value: string;
  raw: number;
  delta: { direction: "up" | "down" | "flat"; pct: number | null };
  hint?: string;
  href?: string;
};

export type KpiSet = {
  totalClients: Kpi;
  activeServices: Kpi;
  monthlyRevenue: Kpi;
  openTickets: Kpi;
  automationRuns: Kpi;
  platformHealth: Kpi;
  configured: boolean;
};

const fmtNumber = (n: number) => n.toLocaleString("en-US");
const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const emptyDelta = { direction: "flat" as const, pct: null };

const fallback = (): KpiSet => ({
  totalClients: { label: "Total Clients", value: "0", raw: 0, delta: emptyDelta, href: "/console/clients" },
  activeServices: { label: "Active Services", value: "0", raw: 0, delta: emptyDelta, href: "/console/billing" },
  monthlyRevenue: { label: "Monthly Revenue", value: "$0", raw: 0, delta: emptyDelta, href: "/console/billing" },
  openTickets: { label: "Open Tickets", value: "0", raw: 0, delta: emptyDelta, href: "/console/support" },
  automationRuns: { label: "Automation Runs", value: "0", raw: 0, delta: emptyDelta, href: "/console/automation" },
  platformHealth: { label: "Platform Health", value: "Unknown", raw: 0, delta: emptyDelta, hint: "—", href: "/console/security" },
  configured: false,
});

export const loadKpis = async (): Promise<KpiSet> => {
  if (!isPanelDbConfigured()) return fallback();

  // Run all queries in parallel.
  const [
    clientsThisMonth,
    clientsLastMonth,
    activeSubsThisMonth,
    activeSubsLastMonth,
    revenueThisMonth,
    revenueLastMonth,
    openTicketsCount,
    ticketsLastMonth,
    automationThisMonth,
    automationLastMonth,
    moduleHealth,
  ] = await Promise.all([
    panelQuery<{ count: string }>(
      "SELECT COUNT(*)::int AS count FROM tenants WHERE createdat <= NOW()"
    ),
    panelQuery<{ count: string }>(
      "SELECT COUNT(*)::int AS count FROM tenants WHERE createdat <= NOW() - INTERVAL '30 days'"
    ),
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count
         FROM subscriptions
        WHERE status IN ('active','trialing')`
    ),
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count
         FROM subscriptions
        WHERE status IN ('active','trialing')
          AND createdat <= NOW() - INTERVAL '30 days'`
    ),
    panelQuery<{ total: string }>(
      `SELECT COALESCE(SUM(total)::numeric, 0)::text AS total
         FROM invoices
        WHERE status IN ('paid','captured','succeeded') AND createdat >= date_trunc('month', NOW())`
    ),
    panelQuery<{ total: string }>(
      `SELECT COALESCE(SUM(total)::numeric, 0)::text AS total
         FROM invoices
        WHERE status IN ('paid','captured','succeeded')
          AND createdat >= date_trunc('month', NOW() - INTERVAL '1 month')
          AND createdat <  date_trunc('month', NOW())`
    ),
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM chat_tickets WHERE status NOT IN ('closed','resolved')`
    ),
    Promise.resolve([{ count: "0" }] as Array<{ count: string }>),
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count
         FROM job_runs
        WHERE COALESCE("startedAt", "createdAt") >= date_trunc('month', NOW())`
    ),
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM job_runs
        WHERE COALESCE("startedAt", "createdAt") >= date_trunc('month', NOW() - INTERVAL '1 month')
          AND COALESCE("startedAt", "createdAt") <  date_trunc('month', NOW())`
    ),
    panelQuery<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::int AS count
         FROM (
           SELECT DISTINCT ON (integration_key) integration_key, status
             FROM integration_health_checks
            WHERE checked_at >= NOW() - INTERVAL '15 minutes'
            ORDER BY integration_key, checked_at DESC
         ) latest
        GROUP BY status`
    ),
  ]);

  const num = (rows: ReadonlyArray<{ count?: string; total?: string }>, key: "count" | "total") => {
    const r = rows[0];
    if (!r) return 0;
    const v = key === "count" ? r.count : r.total;
    return v == null ? 0 : Number(v);
  };

  const computeDelta = (current: number, prior: number) => {
    if (prior === 0) {
      return current === 0 ? emptyDelta : { direction: "up" as const, pct: 100 };
    }
    const diff = ((current - prior) / prior) * 100;
    return {
      direction: diff > 0.5 ? ("up" as const) : diff < -0.5 ? ("down" as const) : ("flat" as const),
      pct: Math.round(Math.abs(diff) * 10) / 10,
    };
  };

  const clientsNow = num(clientsThisMonth, "count");
  const clientsPrev = num(clientsLastMonth, "count");
  const subsNow = num(activeSubsThisMonth, "count");
  const subsPrev = num(activeSubsLastMonth, "count");
  // invoices.total is stored in dollars (numeric), not cents
  const revNow = num(revenueThisMonth, "total");
  const revPrev = num(revenueLastMonth, "total");
  const openTickets = num(openTicketsCount, "count");
  const openTicketsPrev = num(ticketsLastMonth, "count");
  const autoNow = num(automationThisMonth, "count");
  const autoPrev = num(automationLastMonth, "count");

  // Platform health rollup
  const healthyCount = moduleHealth.find((r) => r.status === "ok");
  const totalCount = moduleHealth.reduce((acc, r) => acc + Number(r.count || 0), 0);
  const healthyN = healthyCount ? Number(healthyCount.count) : 0;
  const ratio = totalCount === 0 ? 0 : healthyN / totalCount;
  const healthLabel =
    totalCount === 0
      ? "Unknown"
      : ratio >= 0.95
        ? "Excellent"
        : ratio >= 0.85
          ? "Healthy"
          : ratio >= 0.7
            ? "Degraded"
            : "Critical";
  const healthHint =
    totalCount === 0
      ? "—"
      : `${Math.round((healthyN / totalCount) * 100)}% Operational`;

  return {
    totalClients: {
      label: "Total Clients",
      value: fmtNumber(clientsNow),
      raw: clientsNow,
      delta: computeDelta(clientsNow, clientsPrev),
      href: "/console/clients",
    },
    activeServices: {
      label: "Active Services",
      value: fmtNumber(subsNow),
      raw: subsNow,
      delta: computeDelta(subsNow, subsPrev),
      href: "/console/billing",
    },
    monthlyRevenue: {
      label: "Monthly Revenue",
      value: fmtUsd(revNow),
      raw: revNow,
      delta: computeDelta(revNow, revPrev),
      href: "/console/billing",
    },
    openTickets: {
      label: "Open Tickets",
      value: fmtNumber(openTickets),
      raw: openTickets,
      delta: openTickets === 0 ? emptyDelta : computeDelta(openTickets, openTicketsPrev),
      href: "/console/support",
    },
    automationRuns: {
      label: "Automation Runs",
      value: fmtNumber(autoNow),
      raw: autoNow,
      delta: computeDelta(autoNow, autoPrev),
      href: "/console/automation",
    },
    platformHealth: {
      label: "Platform Health",
      value: healthLabel,
      raw: totalCount === 0 ? 0 : Math.round((healthyN / totalCount) * 100),
      delta: emptyDelta,
      hint: healthHint,
      href: "/console/security",
    },
    configured: true,
  };
};
