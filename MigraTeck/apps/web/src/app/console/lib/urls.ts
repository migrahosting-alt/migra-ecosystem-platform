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

export const tenantPath = (id: string) => `/console/clients/${id}`;
export const tenantUrl = (id: string) => `${PUBLIC_BASE_URL}${tenantPath(id)}`;

export const addServicePath = (id: string) => `${tenantPath(id)}/add-service`;
export const addProductPath = (id: string) => `${tenantPath(id)}/add-product`;
export const addAddonPath = (id: string) => `${tenantPath(id)}/add-addon`;
export const editTenantPath = (id: string) => `${tenantPath(id)}/edit`;
