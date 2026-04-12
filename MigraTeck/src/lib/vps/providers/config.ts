import type { VpsFleetProviderStatus, VpsProviderControlMode, VpsProviderHealthState } from "@/lib/vps/types";
import { mhFetch } from "@/lib/vps/providers/mh/client";
import { proxmoxFetch } from "@/lib/vps/providers/proxmox/client";
import { mapProviderError } from "@/lib/vps/providers/shared/errors";
import { virtualizorFetch } from "@/lib/vps/providers/virtualizor/client";

type ProviderFleetStats = {
  serverCount: number;
  stubServerCount?: number;
  lastSyncedAt?: string;
};

type ProviderCatalogItem = {
  slug: "mh" | "proxmox" | "virtualizor";
  label: string;
  isConfigured: () => boolean;
  probeHealth?: () => Promise<ProviderHealthProbe>;
};

type ProviderHealthProbe = {
  state: VpsProviderHealthState;
  detail: string;
  checkedAt: string;
};

const providerCatalog: ProviderCatalogItem[] = [
  {
    slug: "mh",
    label: "MigraHosting API",
    isConfigured: () => Boolean(
      (process.env.MH_API_BASE_URL || process.env.MIGRATECK_VPS_PROVIDER_BASE_URL)
      && (process.env.MH_API_TOKEN || process.env.MIGRATECK_VPS_PROVIDER_TOKEN),
    ),
    probeHealth: async () => {
      const response = await mhFetch<{ status?: string; serverCount?: number }>("/v1/health", {}, { retries: 0, timeoutMs: 4000 });
      return {
        state: response.status === "ok" ? "HEALTHY" : "DEGRADED",
        detail: response.status === "ok"
          ? `Health probe succeeded against the MH API contract${typeof response.serverCount === "number" ? ` with ${response.serverCount} tracked ${response.serverCount === 1 ? "server" : "servers"}` : ""}.`
          : "Health probe reached the MH API contract, but it did not report an OK status.",
        checkedAt: new Date().toISOString(),
      };
    },
  },
  {
    slug: "proxmox",
    label: "Proxmox Cluster",
    isConfigured: () => Boolean(
      process.env.PROXMOX_API_BASE_URL
      && process.env.PROXMOX_API_TOKEN_ID
      && process.env.PROXMOX_API_TOKEN_SECRET,
    ),
    probeHealth: async () => {
      await proxmoxFetch<{ version?: string } | { data?: { version?: string } }>("/api2/json/version", {}, { retries: 0, timeoutMs: 4000 });
      return {
        state: "HEALTHY",
        detail: "Health probe succeeded against the Proxmox API.",
        checkedAt: new Date().toISOString(),
      };
    },
  },
  {
    slug: "virtualizor",
    label: "Virtualizor",
    isConfigured: () => Boolean(
      process.env.VIRTUALIZOR_API_BASE_URL
      && process.env.VIRTUALIZOR_API_KEY
      && process.env.VIRTUALIZOR_API_PASS,
    ),
    probeHealth: async () => {
      await virtualizorFetch<Record<string, unknown>>("?act=adminindex", {}, { retries: 0, timeoutMs: 4000 });
      return {
        state: "HEALTHY",
        detail: "Health probe succeeded against the Virtualizor API.",
        checkedAt: new Date().toISOString(),
      };
    },
  },
];

export type VpsProviderRuntimeSummary = {
  slug: ProviderCatalogItem["slug"];
  label: string;
  configured: boolean;
  forcedStubMode: boolean;
  detail: string;
  healthState: VpsProviderHealthState;
  healthDetail: string;
  healthCheckedAt?: string;
};

function unknownHealth(detail: string): ProviderHealthProbe {
  return {
    state: "UNKNOWN",
    detail,
    checkedAt: new Date().toISOString(),
  };
}

async function probeProviderHealth(provider: ProviderCatalogItem, configured: boolean): Promise<ProviderHealthProbe> {
  if (!configured) {
    return unknownHealth("Runtime credentials are missing, so no live health probe can run.");
  }

  if (!provider.probeHealth) {
    return unknownHealth("Runtime credentials are present, but this provider does not expose an active health probe yet.");
  }

  try {
    return await provider.probeHealth();
  } catch (error) {
    const normalized = mapProviderError(provider.slug, error);
    const state = normalized.code === "AUTH_FAILED" || normalized.code === "RATE_LIMITED" || normalized.code === "PROVIDER_HTTP_ERROR"
      ? "DEGRADED"
      : "UNREACHABLE";
    const detail = normalized.code === "AUTH_FAILED"
      ? "Provider endpoint is reachable, but the configured credentials were rejected."
      : normalized.code === "RATE_LIMITED"
        ? "Provider endpoint is reachable, but it is currently rate limiting requests."
        : normalized.code === "PROVIDER_HTTP_ERROR"
          ? normalized.message
          : "Provider endpoint did not respond within the health probe window.";

    return {
      state,
      detail,
      checkedAt: new Date().toISOString(),
    };
  }
}

function getProviderCatalogItem(slug: string) {
  return providerCatalog.find((provider) => provider.slug === slug);
}

function isForcedStubMode(slug: ProviderCatalogItem["slug"]) {
  return slug === "mh" && process.env.MH_STUB_MODE === "true";
}

function resolveProviderControlMode(
  slug: ProviderCatalogItem["slug"],
  configured: boolean,
  serverCount: number,
  stubServerCount: number,
): VpsProviderControlMode {
  if (isForcedStubMode(slug)) {
    return "STUB";
  }

  if (stubServerCount > 0 && stubServerCount < serverCount) {
    return "MIXED";
  }

  if (stubServerCount > 0) {
    return "STUB";
  }

  if (configured) {
    return "LIVE_API";
  }

  return "UNCONFIGURED";
}

export function isVpsProviderConfigured(slug: string) {
  return getProviderCatalogItem(slug)?.isConfigured() ?? false;
}

export function getVpsProviderLabel(slug: string) {
  return getProviderCatalogItem(slug)?.label || slug.toUpperCase();
}

export async function listVpsProviderRuntimeSummaries(): Promise<VpsProviderRuntimeSummary[]> {
  return Promise.all(providerCatalog.map(async (provider) => {
    const configured = provider.isConfigured();
    const forcedStubMode = isForcedStubMode(provider.slug);
    const health = await probeProviderHealth(provider, configured);

    return {
      slug: provider.slug,
      label: provider.label,
      configured,
      forcedStubMode,
      detail: forcedStubMode
        ? "Runtime is explicitly pinned to stub mode. Live provider authority is disabled until the flag is removed."
        : configured
          ? "Runtime credentials are present and the provider API can be used for live control."
          : "Runtime credentials are missing, so live provider control is unavailable.",
      healthState: health.state,
      healthDetail: health.detail,
      ...(health.checkedAt ? { healthCheckedAt: health.checkedAt } : {}),
    };
  }));
}

export async function getVpsProviderRuntimeSummary(slug: string): Promise<VpsProviderRuntimeSummary | null> {
  const provider = getProviderCatalogItem(slug);
  if (!provider) {
    return null;
  }

  const configured = provider.isConfigured();
  const forcedStubMode = isForcedStubMode(provider.slug);
  const health = await probeProviderHealth(provider, configured);

  return {
    slug: provider.slug,
    label: provider.label,
    configured,
    forcedStubMode,
    detail: forcedStubMode
      ? "Runtime is explicitly pinned to stub mode. Live provider authority is disabled until the flag is removed."
      : configured
        ? "Runtime credentials are present and the provider API can be used for live control."
        : "Runtime credentials are missing, so live provider control is unavailable.",
    healthState: health.state,
    healthDetail: health.detail,
    ...(health.checkedAt ? { healthCheckedAt: health.checkedAt } : {}),
  };
}

export async function buildVpsFleetProviderStatuses(providerStats: Record<string, ProviderFleetStats>): Promise<VpsFleetProviderStatus[]> {
  return Promise.all(providerCatalog.map(async (provider) => {
    const configured = provider.isConfigured();
    const stats = providerStats[provider.slug] || { serverCount: 0 };
    const serverCount = stats.serverCount;
    const stubServerCount = stats.stubServerCount || 0;
    const state = serverCount > 0 ? "ACTIVE" : configured ? "READY" : "OFFLINE";
    const controlMode = resolveProviderControlMode(provider.slug, configured, serverCount, stubServerCount);
    const health = await probeProviderHealth(provider, configured);

    return {
      slug: provider.slug,
      label: provider.label,
      configured,
      runtimeConfigured: configured,
      status: configured && health.state !== "UNREACHABLE" ? "CONNECTED" : "NOT_CONNECTED",
      state,
      controlMode,
      detail: controlMode === "LIVE_API"
        ? serverCount > 0
          ? `${serverCount} imported ${serverCount === 1 ? "server" : "servers"} under live provider API control`
          : "API configured and ready for discovery"
        : controlMode === "MIXED"
          ? `${stubServerCount} of ${serverCount} ${serverCount === 1 ? "server is" : "servers are"} still stub-backed while live runtime credentials are present`
          : controlMode === "STUB"
            ? serverCount > 0
              ? `${stubServerCount} ${stubServerCount === 1 ? "server is" : "servers are"} currently operating through stub-backed control data`
              : "Stub mode is enabled for this provider"
            : serverCount > 0
              ? "Imported inventory is visible, but runtime credentials are missing"
              : "Credentials missing in runtime configuration",
      healthState: health.state,
      healthDetail: health.detail,
      ...(health.checkedAt ? { healthCheckedAt: health.checkedAt } : {}),
      serverCount,
      stubServerCount,
      ...(stats.lastSyncedAt ? { lastSyncedAt: stats.lastSyncedAt } : {}),
    };
  }));
}

export function getConfiguredVpsProviderSlugs() {
  return providerCatalog.filter((provider) => provider.isConfigured()).map((provider) => provider.slug);
}