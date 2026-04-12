import { VpsProviderHealthState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mapProviderError } from "@/lib/vps/providers/shared/errors";
import type { ProviderServerSummary } from "@/lib/vps/providers/types";

type LocalServerSnapshot = {
  hostname: string;
  planSlug: string;
  powerState: string;
};

export function classifyProviderHealth(error: unknown) {
  const normalized = mapProviderError("vps", error);

  if (normalized.code === "AUTH_FAILED" || normalized.code === "RATE_LIMITED" || normalized.code === "PROVIDER_HTTP_ERROR") {
    return {
      providerHealthState: VpsProviderHealthState.DEGRADED,
      providerError: normalized.message,
    };
  }

  return {
    providerHealthState: VpsProviderHealthState.UNREACHABLE,
    providerError: normalized.message,
  };
}

export function healthyProviderState() {
  return {
    providerHealthState: VpsProviderHealthState.HEALTHY,
    providerError: null,
  } as const;
}

export function detectServerDrift(input: {
  local: LocalServerSnapshot;
  remote: ProviderServerSummary;
  firewallDriftDetected: boolean;
}) {
  const driftTypes: string[] = [];

  if (input.firewallDriftDetected) {
    driftTypes.push("FIREWALL_MISMATCH");
  }

  if (input.local.powerState !== input.remote.powerState) {
    driftTypes.push("POWER_STATE_MISMATCH");
  }

  if (input.local.hostname !== input.remote.hostname || input.local.planSlug !== input.remote.planSlug) {
    driftTypes.push("CONFIG_MISMATCH");
  }

  return {
    detected: driftTypes.length > 0,
    driftType: driftTypes.length ? driftTypes.join(",") : null,
  };
}

export async function getProviderHealthSummary(orgId: string) {
  const [healthyCount, degradedCount, unreachableCount] = await Promise.all([
    prisma.vpsServer.count({
      where: { orgId, providerHealthState: VpsProviderHealthState.HEALTHY },
    }),
    prisma.vpsServer.count({
      where: { orgId, providerHealthState: VpsProviderHealthState.DEGRADED },
    }),
    prisma.vpsServer.count({
      where: { orgId, providerHealthState: VpsProviderHealthState.UNREACHABLE },
    }),
  ]);

  return {
    healthyCount,
    degradedCount,
    unreachableCount,
  };
}