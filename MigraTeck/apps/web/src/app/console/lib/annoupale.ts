/**
 * AnnouPale Trust & Operations module data.
 *
 * AnnouPale is an external product with its own database and admin surface, so
 * the MigraPanel console has no panel-DB metrics for it. This module therefore
 * shows qualitative operational statuses (Live / Configured / Pending / Not
 * connected yet) and a single REAL web reachability probe — never fabricated
 * counts. All links are canonical apex URLs (annoupale.com, never www) and are
 * verified to exist in the AnnouPale web app (apps/pale-platform/apps/web).
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

export type WebProbe = {
  status: "operational" | "degraded" | "unreachable";
  label: string;
  latencyMs: number | null;
};

/**
 * Real HEAD probe of the AnnouPale web app. Runs server-side per request (the
 * page is force-dynamic, so this never runs at build time). Honest by design:
 * a network failure reports "unreachable", not a fake "operational".
 */
export const probeAnnoupaleWeb = async (): Promise<WebProbe> => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4_000);
    const res = await fetch(ANNOUPALE_BASE, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    const latencyMs = Date.now() - start;
    const ok = res.status < 500;
    return {
      status: ok ? "operational" : "degraded",
      label: ok ? "Operational" : "Degraded",
      latencyMs,
    };
  } catch {
    return { status: "unreachable", label: "Unreachable", latencyMs: Date.now() - start };
  }
};
