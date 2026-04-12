import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

type TenantItem = {
  tenantId: string;
  name: string | null;
  status: string | null;
  plan: string | null;
  classification: "client";
  ownerOrg: string;
  environment: string;
};

type PodItem = {
  podId: string;
  tenantId: string | null;
  namespace: string | null;
  status: string | null;
  plan: string | null;
  classification: "client";
  ownerOrg: string;
  environment: string;
};

type DomainItem = {
  domain: string;
  tenantId: string | null;
  podId: string | null;
  type: string | null;
  status: string | null;
  classification: "client";
  ownerOrg: string;
  environment: string;
};

type ServiceItem = {
  serviceId: string;
  type: string | null;
  host: string | null;
  notes: string | null;
  privateAccess: string | null;
  status: string | null;
  classification: "internal";
  ownerOrg: string;
  environment: string;
};

type TopologyEdge = {
  from: string;
  to: string;
  type: string;
};

type SecretRef = {
  name: string;
  ref: string;
  scope: string;
};

type InventoryDocument = {
  generatedAt: string;
  environment: string;
  tenants: TenantItem[];
  pods: PodItem[];
  domains: DomainItem[];
  services: ServiceItem[];
  topology: {
    edges: TopologyEdge[];
  };
  secretRefs: SecretRef[];
};

const PANEL_ENV_PATH = process.env.MIGRAPANEL_PANEL_ENV_PATH || "/opt/MigraPanel/apps/panel-api/.env";
const INVENTORY_PATH = process.env.MIGRAPILOT_INVENTORY_PATH || "/etc/migrapilot/inventory.json";
const ENVIRONMENT = process.env.MIGRAPILOT_INVENTORY_ENV || "prod";
const CLIENT_OWNER = "MigraHosting";
const INTERNAL_OWNER = "MigraTeck";

function readEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const raw = trimmed.slice(idx + 1).trim();
    out[key] = raw.replace(/^"(.*)"$/, "$1");
  }
  return out;
}

function runJsonQuery<T>(databaseUrl: string, sql: string): T {
  const stdout = execFileSync(
    "psql",
    [databaseUrl, "-At", "-c", sql],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: "" },
      maxBuffer: 10 * 1024 * 1024,
    }
  ).trim();
  return JSON.parse(stdout || "null") as T;
}

function readPm2List(): Array<{ name: string; cwd?: string; pm2_env?: Record<string, unknown> }> {
  const stdout = execFileSync("pm2", ["jlist"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim();
  return JSON.parse(stdout || "[]") as Array<{ name: string; cwd?: string; pm2_env?: Record<string, unknown> }>;
}

function readSystemdStatus(unit: string): string {
  try {
    return execFileSync("systemctl", ["is-active", unit], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function normalizeStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).trim().toLowerCase() || null;
}

function hostFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildServices(): { services: ServiceItem[]; edges: TopologyEdge[]; secretRefs: SecretRef[] } {
  const hostname = os.hostname();
  const pm2 = readPm2List();
  const serviceById = new Map<string, ServiceItem>();
  const edges: TopologyEdge[] = [];
  const secretRefs: SecretRef[] = [];

  const addService = (item: ServiceItem) => {
    serviceById.set(item.serviceId, item);
  };

  addService({
    serviceId: "migrapanel-panel-api",
    type: "control-plane",
    host: `${hostname}:3050`,
    notes: "MigraPanel Core API",
    privateAccess: "tailscale/internal",
    status: readSystemdStatus("migrapanel-panel-api.service"),
    classification: "internal",
    ownerOrg: INTERNAL_OWNER,
    environment: ENVIRONMENT,
  });

  addService({
    serviceId: "migrapanel-dns-worker",
    type: "worker",
    host: hostname,
    notes: "DNS worker",
    privateAccess: "systemd",
    status: readSystemdStatus("migrapanel-dns-worker.service"),
    classification: "internal",
    ownerOrg: INTERNAL_OWNER,
    environment: ENVIRONMENT,
  });

  addService({
    serviceId: "migrapanel-provisioning-worker",
    type: "worker",
    host: hostname,
    notes: "Provisioning worker",
    privateAccess: "systemd",
    status: readSystemdStatus("migrapanel-provisioning-worker.service"),
    classification: "internal",
    ownerOrg: INTERNAL_OWNER,
    environment: ENVIRONMENT,
  });

  addService({
    serviceId: "pdns-tunnel",
    type: "network-tunnel",
    host: hostname,
    notes: "PowerDNS API tunnel",
    privateAccess: "systemd",
    status: readSystemdStatus("pdns-tunnel.service"),
    classification: "internal",
    ownerOrg: INTERNAL_OWNER,
    environment: ENVIRONMENT,
  });

  const pm2Map = new Map(pm2.map((entry) => [entry.name, entry]));
  const pilotConsoleEnv = (pm2Map.get("migrapilot-console")?.pm2_env || {}) as Record<string, unknown>;
  const pilotApiEnv = (pm2Map.get("migrapilot-api")?.pm2_env || {}) as Record<string, unknown>;

  const pm2Services: Array<{ id: string; type: string; host: string | null; notes: string }> = [
    { id: "migrapilot-console", type: "ui", host: `${hostname}:3401`, notes: "Primary command center" },
    { id: "migrapilot-console-canary", type: "ui-canary", host: `${hostname}:3402`, notes: "Canary console" },
    { id: "migrapilot-api", type: "api", host: hostFromUrl(String(pilotApiEnv.MIGRAPILOT_BRAIN_BASE_URL || `http://${hostname}:3377`)), notes: "Pilot API" },
    { id: "migrapilot-runner-local", type: "runner", host: hostFromUrl(String(pilotApiEnv.MIGRAPILOT_LOCAL_RUNNER_URL || "http://127.0.0.1:7788")), notes: "Local tool runner" },
    { id: "migrapilot-runner-server", type: "runner", host: hostFromUrl(String(pilotApiEnv.MIGRAPILOT_SERVER_RUNNER_URL || "http://127.0.0.1:7789")), notes: "Server tool runner" },
  ];

  for (const svc of pm2Services) {
    addService({
      serviceId: svc.id,
      type: svc.type,
      host: svc.host,
      notes: svc.notes,
      privateAccess: "pm2/internal",
      status: pm2Map.has(svc.id) ? "online" : "unknown",
      classification: "internal",
      ownerOrg: INTERNAL_OWNER,
      environment: ENVIRONMENT,
    });
  }

  const marketBridge = String(pilotConsoleEnv.MIGRAPILOT_MARKET_ENGINE_URL || "").trim();
  if (marketBridge) {
    addService({
      serviceId: "migramarket-engine",
      type: "marketing-engine",
      host: hostFromUrl(marketBridge),
      notes: "MigraMarket engine bridge",
      privateAccess: "internal-http",
      status: "configured",
      classification: "internal",
      ownerOrg: INTERNAL_OWNER,
      environment: ENVIRONMENT,
    });
  }

  edges.push(
    { from: "migrapilot-console", to: "migrapilot-api", type: "ui_api" },
    { from: "migrapilot-api", to: "migrapilot-runner-local", type: "runner" },
    { from: "migrapilot-api", to: "migrapilot-runner-server", type: "runner" },
    { from: "migrapanel-dns-worker", to: "pdns-tunnel", type: "dns_transport" },
    { from: "migrapanel-provisioning-worker", to: "migrapanel-panel-api", type: "control_plane" }
  );

  if (marketBridge) {
    edges.push({ from: "migrapilot-console", to: "migramarket-engine", type: "command_bridge" });
  }

  secretRefs.push(
    { name: "migrapilot_job_signing_key", ref: "env:MIGRAPILOT_JOB_SIGNING_KEY", scope: "migrapilot" },
    { name: "migrapilot_market_engine_token", ref: "env:MIGRAPILOT_MARKET_ENGINE_TOKEN", scope: "migrapilot-console" },
    { name: "migrapanel_database_url", ref: "env:DATABASE_URL", scope: "migrapanel-panel-api" }
  );

  return {
    services: Array.from(serviceById.values()),
    edges: uniqueBy(edges, (edge) => `${edge.from}->${edge.to}:${edge.type}`),
    secretRefs,
  };
}

async function main() {
  const panelEnv = readEnvFile(PANEL_ENV_PATH);
  const databaseUrl = panelEnv.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(`DATABASE_URL missing in ${PANEL_ENV_PATH}`);
  }

  const tenants = runJsonQuery<TenantItem[]>(
    databaseUrl,
    `
    select coalesce(json_agg(row_to_json(t)), '[]'::json)::text
    from (
      select
        t.id as "tenantId",
        coalesce(nullif(t.company_name, ''), nullif(t.name, ''), nullif(t.slug, ''), t.id) as name,
        lower(coalesce(nullif(t.status, ''), case when coalesce(t.is_active, true) then 'active' else 'inactive' end)) as status,
        (
          select coalesce(
            nullif(t.settings->'plan'->>'name', ''),
            nullif(t.settings->'plan'->>'type', ''),
            (
              select coalesce(
                nullif(si."configJson"->>'plan', ''),
                nullif(si."productId", ''),
                nullif(si."serviceType", '')
              )
              from service_instances si
              where si."tenantId" = t.id
              order by coalesce(si."updatedAt", si."createdAt", now()) desc
              limit 1
            ),
            (
              select coalesce(
                nullif(s.pricing_model, ''),
                concat('subscription:', s.id)
              )
              from subscriptions s
              where s.tenantid = t.id and lower(coalesce(s.status, '')) in ('active', 'trial')
              order by coalesce(s.createdat, now()) desc
              limit 1
            )
          )
        ) as plan,
        'client' as classification,
        '${CLIENT_OWNER}' as "ownerOrg",
        '${ENVIRONMENT}' as environment
      from tenants t
      where t.deleted_at is null
    ) t;
    `
  );

  const pods = runJsonQuery<PodItem[]>(
    databaseUrl,
    `
    select coalesce(json_agg(row_to_json(p)), '[]'::json)::text
    from (
      select
        cp.hostname as "podId",
        cp.tenantid as "tenantId",
        'cloudpod' as namespace,
        lower(cp.status) as status,
        coalesce(cp.plan_snapshot->>'tier', cp.pool, cp.storage) as plan,
        'client' as classification,
        '${CLIENT_OWNER}' as "ownerOrg",
        '${ENVIRONMENT}' as environment
      from cloud_pods cp
    ) p;
    `
  );

  const domains = runJsonQuery<DomainItem[]>(
    databaseUrl,
    `
    select coalesce(json_agg(row_to_json(d)), '[]'::json)::text
    from (
      select
        domain,
        "tenantId" as "tenantId",
        null::text as "podId",
        role as type,
        lower(coalesce(status, 'unknown')) as status,
        'client' as classification,
        '${CLIENT_OWNER}' as "ownerOrg",
        '${ENVIRONMENT}' as environment
      from domains
    ) d;
    `
  );

  const { services, edges, secretRefs } = buildServices();

  const doc: InventoryDocument = {
    generatedAt: new Date().toISOString(),
    environment: ENVIRONMENT,
    tenants: uniqueBy(tenants, (item) => item.tenantId),
    pods: uniqueBy(pods, (item) => item.podId),
    domains: uniqueBy(domains, (item) => item.domain),
    services: uniqueBy(services, (item) => item.serviceId),
    topology: { edges },
    secretRefs,
  };

  fs.mkdirSync(path.dirname(INVENTORY_PATH), { recursive: true });
  const tmpPath = `${INVENTORY_PATH}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, INVENTORY_PATH);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        inventoryPath: INVENTORY_PATH,
        generatedAt: doc.generatedAt,
        counts: {
          tenants: doc.tenants.length,
          pods: doc.pods.length,
          domains: doc.domains.length,
          services: doc.services.length,
          edges: doc.topology.edges.length,
        },
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
