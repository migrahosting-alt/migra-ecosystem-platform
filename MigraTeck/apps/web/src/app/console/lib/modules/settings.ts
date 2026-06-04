import { panelQuery, isPanelDbConfigured } from "../db";

export type FeatureFlag = { id: string; key: string; enabled: boolean; description: string | null };
export type Entitlement = { id: string; tenantName: string | null; entitlementKey: string; status: string };
export type SystemConfig = { id: string; key: string; value: string | null };

export const loadSettingsData = async () => {
  if (!isPanelDbConfigured()) return { flags: [], entitlements: [], configs: [] };
  const [flags, entitlements, configs] = await Promise.all([
    panelQuery<{ id: string; key: string; enabled: boolean; description: string | null }>(
      `SELECT id, key, COALESCE(enabled, FALSE) AS enabled, NULL::text AS description FROM feature_flags ORDER BY key ASC LIMIT 100`,
    ),
    panelQuery<{ id: string; tenantname: string | null; entitlementkey: string; status: string }>(
      `SELECT teg.id, t.name AS tenantname,
              teg.key AS entitlementkey,
              'active'::text AS status
         FROM tenant_entitlement_grants teg
         LEFT JOIN tenants t ON t.id = teg."tenantId"
        ORDER BY teg."createdAt" DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; key: string; value: string | null }>(
      `SELECT id, 'systemMode' AS key, "systemMode"::text AS value FROM system_control_configs
       UNION ALL SELECT id, 'aiGenerationEnabled', "aiGenerationEnabled"::text FROM system_control_configs
       UNION ALL SELECT id, 'autonomyEnabled', "autonomyEnabled"::text FROM system_control_configs
       UNION ALL SELECT id, 'winnerPromotionEnabled', "winnerPromotionEnabled"::text FROM system_control_configs
       UNION ALL SELECT id, 'emergencyStopEnabled', "emergencyStopEnabled"::text FROM system_control_configs
       UNION ALL SELECT id, 'requireHumanApproval', "requireHumanApproval"::text FROM system_control_configs
       UNION ALL SELECT id, 'reviewCadence', "reviewCadence"::text FROM system_control_configs
       LIMIT 100`,
    ),
  ]);
  return {
    flags: flags.map((f) => ({ id: f.id, key: f.key, enabled: f.enabled, description: f.description })),
    entitlements: entitlements.map((e) => ({ id: e.id, tenantName: e.tenantname, entitlementKey: e.entitlementkey, status: e.status })),
    configs: configs.map((c) => ({ id: c.id, key: c.key, value: c.value })),
  };
};
