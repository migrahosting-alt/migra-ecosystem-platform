import { panelQuery, isPanelDbConfigured } from "../db";

/**
 * Lightweight tenant lookups. Use these from server actions instead of the
 * heavy `loadClientDetail` (which pulls subscriptions/invoices/mailboxes/etc.)
 * when you only need the display name.
 */

export type TenantHeader = {
  id: string;
  name: string;
  billingEmail: string | null;
  status: string;
};

export const loadTenantHeader = async (id: string): Promise<TenantHeader | null> => {
  if (!isPanelDbConfigured() || !id) return null;
  const rows = await panelQuery<{
    id: string;
    name: string;
    billing_email: string | null;
    status: string | null;
  }>(
    `SELECT id,
            COALESCE(name, company_name, slug, id) AS name,
            billing_email,
            COALESCE(status, 'active') AS status
       FROM tenants WHERE id = $1
      LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: r.id,
    name: r.name,
    billingEmail: r.billing_email,
    status: r.status || "active",
  };
};

/** Shorthand when only the display name is needed. */
export const loadTenantName = async (id: string): Promise<string> => {
  const h = await loadTenantHeader(id);
  return h?.name || id;
};
