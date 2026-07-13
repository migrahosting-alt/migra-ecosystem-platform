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
export type BillingPayment = {
  id: string;
  amount: number;
  status: string;
  createdAt: string | null;
  tenantName: string | null;
  tenantId: string | null;
  invoiceId: string | null;
  provider: string | null;
  providerRef: string | null;
};
export type BillingPaymentMethod = {
  id: string;
  provider: string | null;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  status: string;
};
export type BillingSubscription = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  status: string;
  pricingModel: string | null;
  originalRate: number | null;
  renewalRate: number | null;
};

export type BillingQuery = {
  tenantId?: string;
};

export const loadBillingData = async (query: BillingQuery = {}) => {
  if (!isPanelDbConfigured()) {
    return { invoices: [], payments: [], subscriptions: [], paymentMethods: [] };
  }

  const where: string[] = [];
  const params: Array<string> = [];
  if (query.tenantId) {
    params.push(query.tenantId);
    where.push(`tenantid = $${params.length}`);
  }
  const invoiceWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const paymentWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const subWhere = where.length ? `WHERE ${where.map((clause) => clause.replaceAll("tenantid", "s.tenantid")).join(" AND ")}` : "";

  const paymentMethodWhere = query.tenantId ? `WHERE pm.tenantid::text = $1` : "";

  const [invoiceRows, paymentRows, subRows, paymentMethodRows] = await Promise.all([
    panelQuery<{
      id: string; status: string; total: string; currency: string | null;
      tenantid: string | null; tenantname: string | null; createdat: string | null; dueat: string | null;
    }>(
      `SELECT i.id, i.status, i.total::text AS total, COALESCE(i.currency, 'USD') AS currency,
              i.tenantid, t.name AS tenantname,
              i.createdat::text AS createdat, i.dueat::text AS dueat
         FROM invoices i
         LEFT JOIN tenants t ON t.id = i.tenantid
        ${invoiceWhere}
        ORDER BY i.createdat DESC NULLS LAST
        LIMIT 50`,
      params,
    ),
    panelQuery<{
      id: string; amount: string; status: string; createdat: string | null; tenantname: string | null;
      tenantid: string | null; invoiceid: string | null; provider: string | null; providerref: string | null;
    }>(
      `SELECT p.id, COALESCE(p.amount::text, '0') AS amount, COALESCE(p.status, 'unknown') AS status,
              p.createdat::text AS createdat, t.name AS tenantname, p.tenantid, p.invoiceid,
              p.provider, p.providerref
         FROM payments p
         LEFT JOIN tenants t ON t.id = p.tenantid
        ${paymentWhere.replaceAll("tenantid", "p.tenantid")}
        ORDER BY p.createdat DESC NULLS LAST
        LIMIT 50`,
      params,
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
        ${subWhere}
        ORDER BY s.createdat DESC NULLS LAST
        LIMIT 50`,
      params,
    ),
    panelQuery<{
      id: string;
      provider: string | null;
      type: string;
      brand: string | null;
      last4: string | null;
      expmonth: number | null;
      expyear: number | null;
      status: string;
    }>(
      `SELECT pm.id, pm.provider, pm.type, pm.brand, pm.last4, pm.expmonth, pm.expyear, pm.status
         FROM payment_methods pm
         ${paymentMethodWhere}
        ORDER BY pm.createdat DESC NULLS LAST
        LIMIT 20`,
      query.tenantId ? [query.tenantId] : [],
    ),
  ]);

  const invoices: BillingInvoice[] = invoiceRows.map((r) => ({
    id: r.id, status: r.status, total: Number(r.total) || 0, currency: r.currency || "USD",
    tenantId: r.tenantid, tenantName: r.tenantname, createdAt: r.createdat, dueAt: r.dueat,
  }));
  const payments: BillingPayment[] = paymentRows.map((r) => ({
    id: r.id,
    amount: Number(r.amount) || 0,
    status: r.status,
    createdAt: r.createdat,
    tenantName: r.tenantname,
    tenantId: r.tenantid,
    invoiceId: r.invoiceid,
    provider: r.provider,
    providerRef: r.providerref,
  }));
  const subscriptions: BillingSubscription[] = subRows.map((r) => ({
    id: r.id, tenantId: r.tenantid, tenantName: r.tenantname, status: r.status,
    pricingModel: r.pricingmodel,
    originalRate: r.originalrate == null ? null : Number(r.originalrate),
    renewalRate: r.renewalrate == null ? null : Number(r.renewalrate),
  }));
  const paymentMethods: BillingPaymentMethod[] = paymentMethodRows.map((r) => ({
    id: r.id,
    provider: r.provider,
    type: r.type,
    brand: r.brand,
    last4: r.last4,
    expMonth: r.expmonth,
    expYear: r.expyear,
    status: r.status,
  }));
  return { invoices, payments, subscriptions, paymentMethods };
};
