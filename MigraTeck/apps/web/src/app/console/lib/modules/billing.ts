import { panelQuery, isPanelDbConfigured } from "../db";

export type BillingInvoice = {
  id: string;
  status: string;
  total: number;
  currency: string;
  tenantId: string | null;
  tenantName: string | null;
  createdAt: string | null;
  dueAt: string | null;
};
export type BillingPayment = { id: string; amount: number; status: string; createdAt: string | null; tenantName: string | null };
export type BillingSubscription = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  status: string;
  pricingModel: string | null;
  originalRate: number | null;
  renewalRate: number | null;
};

export const loadBillingData = async () => {
  if (!isPanelDbConfigured()) {
    return { invoices: [], payments: [], subscriptions: [] };
  }

  const [invoiceRows, paymentRows, subRows] = await Promise.all([
    panelQuery<{
      id: string; status: string; total: string; currency: string | null;
      tenantid: string | null; tenantname: string | null; createdat: string | null; dueat: string | null;
    }>(
      `SELECT i.id, i.status, i.total::text AS total, COALESCE(i.currency, 'USD') AS currency,
              i.tenantid, t.name AS tenantname,
              i.createdat::text AS createdat, i.dueat::text AS dueat
         FROM invoices i
         LEFT JOIN tenants t ON t.id = i.tenantid
        ORDER BY i.createdat DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; amount: string; status: string; createdat: string | null; tenantname: string | null }>(
      `SELECT p.id, COALESCE(p.amount::text, '0') AS amount, COALESCE(p.status, 'unknown') AS status,
              p.createdat::text AS createdat, t.name AS tenantname
         FROM payments p
         LEFT JOIN tenants t ON t.id = p.tenantid
        ORDER BY p.createdat DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{
      id: string; tenantid: string | null; tenantname: string | null;
      status: string; pricingmodel: string | null; originalrate: string | null; renewalrate: string | null;
    }>(
      `SELECT s.id, s.tenantid, t.name AS tenantname, s.status,
              s.pricing_model AS pricingmodel,
              s.original_rate::text AS originalrate,
              s.renewal_rate::text AS renewalrate
         FROM subscriptions s
         LEFT JOIN tenants t ON t.id = s.tenantid
        ORDER BY s.createdat DESC NULLS LAST
        LIMIT 50`,
    ),
  ]);

  const invoices: BillingInvoice[] = invoiceRows.map((r) => ({
    id: r.id, status: r.status, total: Number(r.total) || 0, currency: r.currency || "USD",
    tenantId: r.tenantid, tenantName: r.tenantname, createdAt: r.createdat, dueAt: r.dueat,
  }));
  const payments: BillingPayment[] = paymentRows.map((r) => ({
    id: r.id, amount: Number(r.amount) || 0, status: r.status, createdAt: r.createdat, tenantName: r.tenantname,
  }));
  const subscriptions: BillingSubscription[] = subRows.map((r) => ({
    id: r.id, tenantId: r.tenantid, tenantName: r.tenantname, status: r.status,
    pricingModel: r.pricingmodel,
    originalRate: r.originalrate == null ? null : Number(r.originalrate),
    renewalRate: r.renewalrate == null ? null : Number(r.renewalrate),
  }));
  return { invoices, payments, subscriptions };
};
