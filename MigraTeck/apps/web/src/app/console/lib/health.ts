/**
 * Live HTTP health probes for each service.
 *
 * These are run server-side from the Command Center's API route. We probe a
 * known health endpoint or root URL per service and measure response. Uptime
 * percentages come from the panel DB `integration_health_checks` table when
 * recent checks exist; otherwise we fall back to the live probe's pass/fail.
 */

import { unstable_cache } from "next/cache";
import { panelQuery, isPanelDbConfigured } from "./db";

export type ServiceHealth = {
  id: string;
  shortCode: string; // e.g. "MH"
  label: string; // "Hosting"
  uptime: number | null; // percentage 0..100
  status: "ok" | "degraded" | "down" | "unknown";
  endpoint: string;
  href: string;
  lastCheckMs?: number;
};

const SERVICES: Array<{
  id: string;
  shortCode: string;
  label: string;
  endpoint: string;
  href: string;
}> = [
  { id: "migrateck-core", shortCode: "MT", label: "MigraTeck Core", endpoint: "https://migrateck.com/api/health", href: "/console/ecosystem" },
  { id: "hosting", shortCode: "MH", label: "Hosting (MH)", endpoint: "https://migrahosting.com", href: "/console/hosting" },
  { id: "panel", shortCode: "MP", label: "MigraPanel (MP)", endpoint: "https://panel.migrahosting.com", href: "/console/clients" },
  { id: "voice", shortCode: "MV", label: "Voice Services (MV)", endpoint: "https://voice.migrahosting.com", href: "/console/voice" },
  { id: "email", shortCode: "MM", label: "Email Services (MM)", endpoint: "https://mail.migrahosting.com", href: "/console/email" },
  { id: "intake", shortCode: "MI", label: "Intake (MI)", endpoint: "https://intake.migrahosting.com", href: "/console/intake" },
  { id: "marketing", shortCode: "MK", label: "Marketing (MK)", endpoint: "https://marketing.migrahosting.com", href: "/console/marketing" },
  { id: "automation", shortCode: "AU", label: "Automation (AU)", endpoint: "https://migrateck.com", href: "/console/automation" },
];

const probeOne = async (s: (typeof SERVICES)[number]): Promise<ServiceHealth> => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4_000);
    const res = await fetch(s.endpoint, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    const ms = Date.now() - start;
    const ok = res.status < 500;
    return {
      id: s.id,
      shortCode: s.shortCode,
      label: s.label,
      uptime: null,
      status: ok ? "ok" : "degraded",
      endpoint: s.endpoint,
      href: s.href,
      lastCheckMs: ms,
    };
  } catch {
    return {
      id: s.id,
      shortCode: s.shortCode,
      label: s.label,
      uptime: null,
      status: "down",
      endpoint: s.endpoint,
      href: s.href,
      lastCheckMs: Date.now() - start,
    };
  }
};

const loadServiceHealthUncached = async (): Promise<ServiceHealth[]> => {
  const probes = await Promise.all(SERVICES.map(probeOne));

  // Merge the most recent integration health signal when recent checks exist.
  if (isPanelDbConfigured()) {
    const rows = await panelQuery<{ integrationkey: string; status: string }>(
      `SELECT DISTINCT ON (integration_key)
              integration_key AS integrationkey,
              LOWER(status) AS status
         FROM integration_health_checks
        WHERE checked_at >= NOW() - INTERVAL '7 days'
        ORDER BY integration_key, checked_at DESC`,
    );
    const map = new Map(
      rows.map((row) => [row.integrationkey, row.status] as const),
    );
    const integrationKeysByService = new Map<string, string[]>([
      ["panel", ["stripe", "powerdns"]],
      ["email", ["mailcore"]],
    ]);
    for (const p of probes) {
      const keys = integrationKeysByService.get(p.id) ?? [];
      const statuses = keys
        .map((key) => map.get(key))
        .filter((status): status is string => Boolean(status));
      if (statuses.length === 0) continue;
      const healthyCount = statuses.filter((status) => status === "healthy" || status === "ok").length;
      p.uptime = Math.round((healthyCount / statuses.length) * 100);
    }
  }

  return probes;
};

export const loadServiceHealth = unstable_cache(
  loadServiceHealthUncached,
  ["console-service-health"],
  { revalidate: 60 },
);

export const aggregateHealth = (services: ReadonlyArray<ServiceHealth>) => {
  const allOk = services.every((s) => s.status === "ok");
  const anyDown = services.some((s) => s.status === "down");
  return allOk ? "All Systems Operational" : anyDown ? "Service Outage" : "Partial Degradation";
};
