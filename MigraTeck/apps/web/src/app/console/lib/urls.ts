/**
 * Centralized URL builders for the Command Center.
 *
 * Use these helpers instead of hard-coding paths so refactors stay easy and
 * outbound links (used in Slack/email notifications) all share one base URL.
 *
 * The public base URL is read from CONSOLE_PUBLIC_URL with a sensible default.
 */

export const PUBLIC_BASE_URL: string =
  process.env.CONSOLE_PUBLIC_URL?.replace(/\/+$/, "") || "https://console.migrateck.com";

const withQuery = (path: string, query: Record<string, string | null | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

export const tenantPath = (id: string) => `/console/clients/${id}`;
export const tenantUrl = (id: string) => `${PUBLIC_BASE_URL}${tenantPath(id)}`;

export const addServicePath = (id: string) => `${tenantPath(id)}/add-service`;
export const addProductPath = (id: string) => `${tenantPath(id)}/add-product`;
export const addAddonPath = (id: string) => `${tenantPath(id)}/add-addon`;
export const editTenantPath = (id: string) => `${tenantPath(id)}/edit`;
export const editDomainPath = (id: string) => `/console/domains/${id}/edit`;
export const editMailboxPath = (id: string) => `/console/email/${id}/edit`;
export const hostingSitePath = (id: string) => `/console/hosting/${id}`;
export const billingPath = () => `/console/billing`;
export const supportPath = () => `/console/support`;
export const activityPath = () => `/console/activity`;
export const clientBillingPath = (tenantId: string) =>
  withQuery("/console/billing", { tenantId, returnTo: tenantPath(tenantId) });
export const clientSupportPath = (tenantId: string) =>
  withQuery("/console/support", { tenantId, returnTo: tenantPath(tenantId) });
export const clientActivityPath = (tenantId: string) =>
  withQuery("/console/activity", { tenantId, returnTo: tenantPath(tenantId) });
export const clientNewTicketPath = (tenantId: string) =>
  withQuery("/console/support/new", { tenantId, returnTo: tenantPath(tenantId) });
export const clientDomainCreatePath = (tenantId: string) =>
  withQuery("/console/domains/new", { tenantId, returnTo: tenantPath(tenantId) });
export const clientMailboxCreatePath = (tenantId: string) =>
  withQuery("/console/email/new", { tenantId, returnTo: tenantPath(tenantId) });
export const clientHostingCreatePath = (tenantId: string, primaryDomain?: string | null) =>
  withQuery("/console/hosting/new", { tenantId, primaryDomain: primaryDomain || null, returnTo: tenantPath(tenantId) });
