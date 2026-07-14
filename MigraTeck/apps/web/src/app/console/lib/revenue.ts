import { panelQuery, isPanelDbConfigured } from "./db";
import type { RevenueData } from "../components/RevenueChart";

const emptyData = (): RevenueData => ({
  series: [],
  totals: {
    revenue: 0,
    mrr: 0,
    overdueInvoices: 0,
    successfulPayments: 0,
    collectionRate: 0,
  },
  delta: {
    revenuePct: 0,
    mrrPct: 0,
    overduePct: 0,
    paymentsPct: 0,
    collectionPct: 0,
  },
});

export const loadRevenueData = async (): Promise<RevenueData> => {
  if (!isPanelDbConfigured()) return emptyData();

  const [
    daily,
    mrrRow,
    mrrPrevRow,
    overdueRow,
    overduePrevRow,
    paymentsRow,
    paymentsPrevRow,
    collectionRow,
    collectionPrevRow,
    revenuePrevRow,
  ] = await Promise.all([
    panelQuery<{ d: string; revenue: string; mrr: string }>(
      `WITH days AS (
         SELECT generate_series(date_trunc('month', NOW()), date_trunc('day', NOW()), '1 day'::interval)::date AS d
       )
       SELECT to_char(days.d, 'YYYY-MM-DD') AS d,
              COALESCE((SELECT SUM(total) FROM invoices i WHERE i.status IN ('paid','captured','succeeded') AND i.createdat::date = days.d), 0)::text AS revenue,
              COALESCE((SELECT SUM(COALESCE(renewal_rate, original_rate, 0)) FROM subscriptions s WHERE s.status IN ('active','trialing') AND s.createdat::date <= days.d), 0)::text AS mrr
         FROM days
        ORDER BY days.d`,
    ),
    panelQuery<{ mrr: string }>(
      `SELECT COALESCE(SUM(COALESCE(renewal_rate, original_rate, 0)),0)::text AS mrr FROM subscriptions WHERE status IN ('active','trialing')`,
    ),
    panelQuery<{ mrr: string }>(
      `SELECT COALESCE(SUM(COALESCE(renewal_rate, original_rate, 0)),0)::text AS mrr
         FROM subscriptions
        WHERE status IN ('active','trialing')
          AND createdat < date_trunc('month', NOW())`,
    ),
    panelQuery<{ overdue: string }>(
      `SELECT COALESCE(SUM(total),0)::text AS overdue FROM invoices WHERE status IN ('open','past_due','draft') AND dueat < NOW()`,
    ),
    panelQuery<{ overdue: string }>(
      `SELECT COALESCE(SUM(total),0)::text AS overdue
         FROM invoices
        WHERE status IN ('open','past_due','draft')
          AND dueat < date_trunc('month', NOW())`,
    ),
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM invoices WHERE status IN ('paid','captured','succeeded') AND createdat >= date_trunc('month', NOW())`,
    ),
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count
         FROM invoices
        WHERE status IN ('paid','captured','succeeded')
          AND createdat >= date_trunc('month', NOW() - INTERVAL '1 month')
          AND createdat < date_trunc('month', NOW())`,
    ),
    panelQuery<{ rate: string }>(
      `WITH paid AS (SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE status IN ('paid','captured','succeeded') AND createdat >= date_trunc('month', NOW())),
            total AS (SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE createdat >= date_trunc('month', NOW()))
       SELECT CASE WHEN total.s = 0 THEN 0
                   ELSE ROUND((paid.s::numeric / total.s) * 100, 1) END AS rate
         FROM paid, total`,
    ),
    panelQuery<{ rate: string }>(
      `WITH paid AS (
         SELECT COALESCE(SUM(total),0) AS s
           FROM invoices
          WHERE status IN ('paid','captured','succeeded')
            AND createdat >= date_trunc('month', NOW() - INTERVAL '1 month')
            AND createdat < date_trunc('month', NOW())
       ),
       total AS (
         SELECT COALESCE(SUM(total),0) AS s
           FROM invoices
          WHERE createdat >= date_trunc('month', NOW() - INTERVAL '1 month')
            AND createdat < date_trunc('month', NOW())
       )
       SELECT CASE WHEN total.s = 0 THEN 0
                   ELSE ROUND((paid.s::numeric / total.s) * 100, 1) END AS rate
         FROM paid, total`,
    ),
    panelQuery<{ revenue: string }>(
      `SELECT COALESCE(SUM(total),0)::text AS revenue
         FROM invoices
        WHERE status IN ('paid','captured','succeeded')
          AND createdat >= date_trunc('month', NOW() - INTERVAL '1 month')
          AND createdat < date_trunc('month', NOW())`,
    ),
  ]);

  const pctDelta = (current: number, previous: number) => {
    if (previous === 0) {
      return current === 0 ? 0 : 100;
    }
    return Number((((current - previous) / previous) * 100).toFixed(1));
  };

  // invoices.total and subscriptions.original_rate/renewal_rate are stored as dollars
  const series = daily.map((r) => ({
    date: r.d,
    revenue: Number(r.revenue),
    mrr: Number(r.mrr),
  }));

  const totalRevenue = series.reduce((acc, d) => acc + d.revenue, 0);
  const mrr = mrrRow[0] ? Number(mrrRow[0].mrr) : 0;
  const mrrPrev = mrrPrevRow[0] ? Number(mrrPrevRow[0].mrr) : 0;
  const overdue = overdueRow[0] ? Number(overdueRow[0].overdue) : 0;
  const overduePrev = overduePrevRow[0] ? Number(overduePrevRow[0].overdue) : 0;
  const payments = paymentsRow[0] ? Number(paymentsRow[0].count) : 0;
  const paymentsPrev = paymentsPrevRow[0] ? Number(paymentsPrevRow[0].count) : 0;
  const collection = collectionRow[0] ? Number(collectionRow[0].rate) : 0;
  const collectionPrev = collectionPrevRow[0] ? Number(collectionPrevRow[0].rate) : 0;
  const revenuePrev = revenuePrevRow[0] ? Number(revenuePrevRow[0].revenue) : 0;

  return {
    series,
    totals: {
      revenue: totalRevenue,
      mrr,
      overdueInvoices: overdue,
      successfulPayments: payments,
      collectionRate: collection,
    },
    delta: {
      revenuePct: pctDelta(totalRevenue, revenuePrev),
      mrrPct: pctDelta(mrr, mrrPrev),
      overduePct: pctDelta(overdue, overduePrev),
      paymentsPct: pctDelta(payments, paymentsPrev),
      collectionPct: pctDelta(collection, collectionPrev),
    },
  };
};
