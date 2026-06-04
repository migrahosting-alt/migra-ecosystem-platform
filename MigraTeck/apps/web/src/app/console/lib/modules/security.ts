import { panelQuery, isPanelDbConfigured } from "../db";

export type AuditEvent = { id: string; actionKey: string; resourceType: string; decision: string; createdAt: string | null; tenantName: string | null; actorEmail: string | null };
export type FailedLogin = { id: string; email: string | null; ip: string | null; createdAt: string | null; reason: string | null };
export type Incident = { id: string; severity: string; status: string; createdAt: string | null; title: string | null };
export type Certificate = { id: string; domain: string | null; issuer: string | null; expiresAt: string | null; status: string };

export const loadSecurityData = async () => {
  if (!isPanelDbConfigured()) return { events: [], failedLogins: [], incidents: [], certs: [] };
  const [events, failedLogins, incidents, certs] = await Promise.all([
    panelQuery<{ id: string; actionkey: string; resourcetype: string; decision: string; createdat: string | null; tenantname: string | null; actoremail: string | null }>(
      `SELECT a.id, a.actionkey, a.resourcetype, a.decision, a.createdat::text AS createdat,
              t.name AS tenantname, u.email AS actoremail
         FROM audit_events a
         LEFT JOIN tenants t ON t.id = a.tenantid
         LEFT JOIN users u ON u.id = a.actoruserid
        ORDER BY a.createdat DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; email: string | null; ip: string | null; createdat: string | null; reason: string | null }>(
      `SELECT id, username AS email, ip_address AS ip, last_attempt::text AS createdat, service AS reason
         FROM failed_login_attempts
        ORDER BY last_attempt DESC NULLS LAST
        LIMIT 30`,
    ),
    panelQuery<{ id: string; severity: string; status: string; createdat: string | null; title: string | null }>(
      `SELECT id, COALESCE(severity, 'medium') AS severity, COALESCE(status, 'open') AS status,
              created_at::text AS createdat, title
         FROM security_incidents
        ORDER BY created_at DESC NULLS LAST
        LIMIT 30`,
    ),
    panelQuery<{ id: string; domain: string | null; issuer: string | null; expiresat: string | null; status: string }>(
      `SELECT id, domain, issuer, expiry_date::text AS expiresat,
              CASE WHEN days_until_expiry > 30 THEN 'valid'
                   WHEN days_until_expiry > 0 THEN 'expiring_soon'
                   ELSE 'expired' END AS status
         FROM certificates
        ORDER BY expiry_date ASC NULLS LAST
        LIMIT 30`,
    ),
  ]);
  return {
    events: events.map((e) => ({ id: e.id, actionKey: e.actionkey, resourceType: e.resourcetype, decision: e.decision, createdAt: e.createdat, tenantName: e.tenantname, actorEmail: e.actoremail })),
    failedLogins: failedLogins.map((f) => ({ id: f.id, email: f.email, ip: f.ip, createdAt: f.createdat, reason: f.reason })),
    incidents: incidents.map((i) => ({ id: i.id, severity: i.severity, status: i.status, createdAt: i.createdat, title: i.title })),
    certs: certs.map((c) => ({ id: c.id, domain: c.domain, issuer: c.issuer, expiresAt: c.expiresat, status: c.status })),
  };
};
