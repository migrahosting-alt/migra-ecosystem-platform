import { panelQuery, isPanelDbConfigured } from "../db";

export type PhoneNumber = { id: string; number: string; status: string; tenantName: string | null };
export type Extension = { id: string; extension: string; displayName: string | null; enabled: boolean };
export type Ivr = { id: string; name: string; status: string };

export const loadVoiceData = async () => {
  if (!isPanelDbConfigured()) return { numbers: [], extensions: [], ivrs: [] };
  const [numbers, extensions, ivrs] = await Promise.all([
    panelQuery<{ id: string; number: string; status: string; tenantname: string | null }>(
      `SELECT n.id, n.displaynumber AS number, COALESCE(n.status, 'active') AS status, t.name AS tenantname
         FROM business_phone_numbers n
         LEFT JOIN tenants t ON t.id = n.tenantid
        ORDER BY n.createdat DESC NULLS LAST
        LIMIT 100`,
    ),
    panelQuery<{ id: string; extension: string; displayname: string | null; enabled: boolean }>(
      `SELECT id, extension, display_name AS displayname, COALESCE(enabled, TRUE) AS enabled
         FROM business_phone_extensions
        ORDER BY extension ASC
        LIMIT 100`,
    ),
    panelQuery<{ id: string; name: string; status: string }>(
      `SELECT id, name, CASE WHEN enabled THEN 'active' ELSE 'inactive' END AS status
         FROM business_phone_ivrs
        ORDER BY name ASC
        LIMIT 50`,
    ),
  ]);
  return {
    numbers: numbers.map((n) => ({ id: n.id, number: n.number, status: n.status, tenantName: n.tenantname })),
    extensions: extensions.map((e) => ({ id: e.id, extension: e.extension, displayName: e.displayname, enabled: e.enabled })),
    ivrs: ivrs.map((i) => ({ id: i.id, name: i.name, status: i.status })),
  };
};

/* ────────────────────────────────────────────────────────────────────────── *
 * Business Phone runtime truth
 *
 * Publishing a customer's phone configuration to the PBX is gated three ways:
 * two environment flags on panel-api (BUSINESS_PHONE_FREEPBX_RUNTIME and
 * BUSINESS_PHONE_RUNTIME_DRY_RUN) and an enabled approval row per customer.
 * Only the approval row lives in this database — the two flags belong to the
 * panel-api service and the console cannot read them, so the page says so
 * rather than implying the gate is fully visible here.
 * ────────────────────────────────────────────────────────────────────────── */

export type RuntimeApproval = {
  id: string;
  customerId: string;
  serviceId: string | null;
  enabled: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
};

export type RuntimeDeployment = {
  id: string;
  customerId: string;
  status: string;
  dryRun: boolean;
  adapterLabel: string | null;
  planHash: string | null;
  customerMessage: string | null;
  at: string | null;
};

export const loadVoiceRuntime = async (): Promise<{
  approvals: RuntimeApproval[];
  deployments: RuntimeDeployment[];
}> => {
  if (!isPanelDbConfigured()) return { approvals: [], deployments: [] };

  const [approvals, deployments] = await Promise.all([
    panelQuery<{
      id: string;
      customerid: string;
      serviceid: string | null;
      enabled: boolean;
      approvedby: string | null;
      approvedat: string | null;
      notes: string | null;
    }>(
      `SELECT id, customerid, serviceid, enabled, approvedby,
              to_char(approvedat, 'YYYY-MM-DD HH24:MI') AS approvedat, notes
         FROM business_phone_runtime_approvals
        ORDER BY updatedat DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{
      id: string;
      customerid: string;
      status: string;
      dryrun: boolean;
      adapterlabel: string | null;
      planhash: string | null;
      customermessage: string | null;
      at: string | null;
    }>(
      `SELECT id, customerid, status, COALESCE(dryrun, TRUE) AS dryrun,
              adapterlabel, planhash, customermessage,
              to_char(COALESCE(completedat, startedat, createdat), 'YYYY-MM-DD HH24:MI') AS at
         FROM business_phone_runtime_deployments
        ORDER BY COALESCE(completedat, startedat, createdat) DESC NULLS LAST
        LIMIT 25`,
    ),
  ]);

  return {
    approvals: approvals.map((a) => ({
      id: a.id,
      customerId: a.customerid,
      serviceId: a.serviceid,
      enabled: a.enabled,
      approvedBy: a.approvedby,
      approvedAt: a.approvedat,
      notes: a.notes,
    })),
    deployments: deployments.map((d) => ({
      id: d.id,
      customerId: d.customerid,
      status: d.status,
      dryRun: d.dryrun,
      adapterLabel: d.adapterlabel,
      planHash: d.planhash,
      customerMessage: d.customermessage,
      at: d.at,
    })),
  };
};
