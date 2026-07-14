import { panelQuery, isPanelDbConfigured } from "./db";
import type { SecurityComplianceData } from "../components/SecurityCompliancePanel";

const empty = (): SecurityComplianceData => ({
  loginAnomalies: { count: 0, period: "This Week" },
  backups: { successPct: 0, period: "Last 7d" },
  sslCoverage: { coveredPct: 0, status: "—" },
  firewall: { active: false, period: "Status unknown" },
  riskScore: 0,
});

export const loadSecurityCompliance = async (): Promise<SecurityComplianceData> => {
  if (!isPanelDbConfigured()) return empty();

  const [
    anomalies,
    backups,
    sslDomains,
    firewall,
  ] = await Promise.all([
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count
         FROM failed_login_attempts
        WHERE last_attempt >= NOW() - INTERVAL '7 days'`,
    ),
    panelQuery<{ pct: string; total: string }>(
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0
                   ELSE ROUND((COUNT(*) FILTER (WHERE status = 'success')::numeric / COUNT(*)) * 100, 1)
              END AS pct,
              COUNT(*)::text AS total
         FROM backup_runs
        WHERE started_at >= NOW() - INTERVAL '7 days'`,
    ),
    panelQuery<{ pct: string }>(
      `SELECT COALESCE(ROUND(
                 (COUNT(*) FILTER (WHERE LOWER(status) IN ('active','issued','valid'))::numeric / NULLIF(COUNT(*), 0)) * 100,
                 1
               ), 0) AS pct
         FROM ssl_certificates`,
    ),
    panelQuery<{ active: string }>(
      `SELECT CASE WHEN COUNT(*) FILTER (WHERE enabled = TRUE) > 0 THEN 'true' ELSE 'false' END AS active
         FROM firewall_rules`,
    ),
  ]);

  const anomalyCount = anomalies[0] ? Number(anomalies[0].count) : 0;
  const backupPct = backups[0] ? Number(backups[0].pct) : 0;
  const backupTotal = backups[0] ? Number(backups[0].total) : 0;
  const sslPct = sslDomains[0] ? Number(sslDomains[0].pct) : 0;
  const fwActive = firewall[0] ? firewall[0].active === "true" : false;

  // Risk score: weighted composite (lower is better).
  // anomalies (cap at 50 = 50 points) + (100 - backup%) * 0.2 + (100 - ssl%) * 0.2 + (firewall inactive: 20)
  const risk = Math.min(
    100,
    Math.round(
      Math.min(50, anomalyCount) * 1.0 +
        (100 - backupPct) * 0.2 +
        (100 - sslPct) * 0.2 +
        (fwActive ? 0 : 20),
    ),
  );

  return {
    loginAnomalies: { count: anomalyCount, period: "This Week" },
    backups: { successPct: Math.round(backupPct), period: backupTotal === 0 ? "No recent runs" : "Last 7d" },
    sslCoverage: { coveredPct: sslPct, status: sslPct >= 95 ? "Secure" : sslPct >= 80 ? "Mostly Secure" : "Needs Attention" },
    firewall: { active: fwActive, period: fwActive ? "Protected" : "No rules tracked" },
    riskScore: risk,
  };
};
