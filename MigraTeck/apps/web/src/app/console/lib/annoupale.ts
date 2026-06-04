/**
 * AnnouPale Trust & Operations module data.
 *
 * AnnouPale is an external product with its own database and admin surface, so
 * the MigraPanel console has no panel-DB metrics for it. This module shows
 * qualitative operational statuses (Live / Configured / Pending / Not connected
 * yet) — never fabricated counts.
 *
 * Reachability note: AnnouPale runs on separate infrastructure
 * (annoupale.com → 138.201.255.55) that is NOT routable from the console host
 * (app-core has no egress/hairpin to it — every connection times out). A
 * server-side probe therefore always times out and falsely reports a down
 * site, so we do NOT probe. We present an honest "External link" status instead
 * (no false downtime, no fake "operational"). A real console-side probe is
 * deferred until a reachable AnnouPale health endpoint exists.
 *
 * All links are canonical apex URLs (annoupale.com, never www) and are verified
 * to exist in the AnnouPale web app (apps/pale-platform/apps/web).
 */

export const ANNOUPALE_BASE = "https://annoupale.com" as const;

const url = (path: string) => `${ANNOUPALE_BASE}${path}`;

/** Canonical, verified AnnouPale deep links (apex domain only). */
export const ANNOUPALE_LINKS = {
  admin: url("/admin"),
  complianceCases: url("/admin/compliance/cases"),
  adminAppeals: url("/admin/appeals"),
  legal: url("/legal"),
  legalContact: url("/legal/contact"),
  privacyRequest: url("/privacy/request"),
  safetyReport: url("/safety/report"),
  securityReport: url("/security/report"),
  ipReport: url("/ip/report"),
  appeals: url("/appeals"),
  accountDeletion: url("/help/account-deletion"),
} as const;

export type LinkStatus = {
  /** "external" = we link out but do not (cannot) measure uptime from here. */
  status: "external";
  label: string;
  detail: string;
};

/**
 * Honest link status for AnnouPale. No network probe is performed (the console
 * host cannot reach annoupale.com — see the file header), so this never reports
 * false downtime and never fakes "operational". It states plainly that the
 * console deep-links to AnnouPale and that uptime is monitored in AnnouPale.
 */
export const getAnnoupaleLinkStatus = (): LinkStatus => ({
  status: "external",
  label: "External link",
  detail: "Opens annoupale.com · uptime monitored in AnnouPale",
});
