/**
 * Live HTTP health probes for each service.
 *
 * These are run server-side from the Command Center's API route. We probe a
 * known health endpoint or root URL per service and measure response. Uptime
 * percentages come from the panel DB `module_health_status` table (rolling
 * 30-day) if present; otherwise we fall back to the live probe's pass/fail.
 */

import { panelQuery, isPanelDbConfigured } from "./db";

export type ServiceHealth = {
  id: string;
  shortCode: string; // e.g. "MH"
  label: string; // "Hosting"
  uptime: number | null; // percentage 0..100
  status: "ok" | "degraded" | "down" | "unknown";
  endpoint: string;
  lastCheckMs?: number;
};

const SERVICES: Array<{
  id: string;
  shortCode: string;
  label: string;
  endpoint: string;
}> = [
  { id: "migrateck-core", shortCode: "MT", label: "MigraTeck Core", endpoint: "https://migrateck.com/api/health" },
  { id: "hosting", shortCode: "MH", label: "Hosting (MH)", endpoint: "https://migrahosting.com" },
  { id: "panel", shortCode: "MP", label: "MigraPanel (MP)", endpoint: "https://panel.migrahosting.com" },
  { id: "voice", shortCode: "MV", label: "Voice Services (MV)", endpoint: "https://voice.migrahosting.com" },
  { id: "email", shortCode: "MM", label: "Email Services (MM)", endpoint: "https://mail.migrahosting.com" },
  { id: "intake", shortCode: "MI", label: "Intake (MI)", endpoint: "https://intake.migrahosting.com" },
  { id: "marketing", shortCode: "MK", label: "Marketing (MK)", endpoint: "https://marketing.migrahosting.com" },
  { id: "automation", shortCode: "AU", label: "Automation (AU)", endpoint: "https://migrateck.com" },
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
      lastCheckMs: Date.now() - start,
    };
  }
};

export const loadServiceHealth = async (): Promise<ServiceHealth[]> => {
  const probes = await Promise.all(SERVICES.map(probeOne));

  // Merge rolling 30d uptime from DB if available.
  if (isPanelDbConfigured()) {
    const rows = await panelQuery<{ moduleid: string; uptime: string }>(
      `SELECT moduleid, uptime_30d AS uptime FROM module_health_status`,
    );
    const map = new Map(rows.map((r) => [r.moduleid, Number(r.uptime)]));
    for (const p of probes) {
      const v = map.get(p.id);
      if (typeof v === "number" && Number.isFinite(v)) p.uptime = v;
    }
  }

  return probes;
};

export const aggregateHealth = (services: ReadonlyArray<ServiceHealth>) => {
  const allOk = services.every((s) => s.status === "ok");
  const anyDown = services.some((s) => s.status === "down");
  return allOk ? "All Systems Operational" : anyDown ? "Service Outage" : "Partial Degradation";
};
