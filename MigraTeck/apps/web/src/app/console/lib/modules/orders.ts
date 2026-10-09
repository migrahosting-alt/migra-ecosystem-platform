import { isPanelDbConfigured, panelQuery } from "../db";

export type ClientOrder = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  status: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentLinkUrl: string | null;
  paymentLinkId: string | null;
  createdAt: string | null;
};

export const loadRecentOrders = async (query: {
  tenantId?: string;
  limit?: number;
} = {}): Promise<ClientOrder[]> => {
  if (!isPanelDbConfigured()) return [];
  const limit = query.limit ?? 10;
  const params: Array<string | number> = [];
  const where: string[] = [];
  if (query.tenantId) {
    params.push(query.tenantId);
    where.push(`o.tenantid = $${params.length}`);
  }
  params.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await panelQuery<{
    id: string;
    tenantid: string | null;
    tenantname: string | null;
    status: string | null;
    subtotal: string | null;
    tax_rate: string | null;
    tax_amount: string | null;
    total: string | null;
    payment_link_url: string | null;
    payment_link_id: string | null;
    createdat: string | null;
  }>(
    `SELECT o.id,
            COALESCE(o.status, 'pending') AS status,
            o.subtotal::text AS subtotal,
            o.tax_rate::text AS tax_rate,
            o.tax_amount::text AS tax_amount,
            o.total::text AS total,
            o.tenantid,
            COALESCE(t.name, t.company_name, t.slug, t.id) AS tenantname,
            o.payment_link_url,
            o.payment_link_id,
            o.createdat::text AS createdat
       FROM orders o
       LEFT JOIN tenants t ON t.id = o.tenantid
      ${whereSql}
      ORDER BY o.createdat DESC NULLS LAST
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantid,
    tenantName: row.tenantname,
    status: row.status || "pending",
    subtotal: Number(row.subtotal || "0") || 0,
    taxRate: Number(row.tax_rate || "0") || 0,
    taxAmount: Number(row.tax_amount || "0") || 0,
    total: Number(row.total || "0") || 0,
    paymentLinkUrl: row.payment_link_url,
    paymentLinkId: row.payment_link_id,
    createdAt: row.createdat,
  }));
};

export const loadRecentOrdersForTenant = async (
  tenantId: string,
  limit = 10,
): Promise<ClientOrder[]> => {
  if (!tenantId) return [];
  return loadRecentOrders({ tenantId, limit });
};
