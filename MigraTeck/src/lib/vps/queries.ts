import { prisma } from "@/lib/prisma";

type ProviderBindingLike = {
  id?: string | undefined;
  providerSlug: string;
  providerServerId: string;
  providerRegionId: string | null;
  providerPlanId: string | null;
  metadataJson: unknown;
  lastSyncedAt?: Date | null;
  updatedAt?: Date;
};

type FirewallProfileLike = {
  isActive: boolean;
  updatedAt?: Date;
};

function compareDatesDescending(left?: Date | null, right?: Date | null) {
  const leftTime = left?.getTime() ?? 0;
  const rightTime = right?.getTime() ?? 0;
  return rightTime - leftTime;
}

export async function getServerForActor(serverId: string, orgId: string) {
  return prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    include: {
      providerBindings: {
        orderBy: { updatedAt: "desc" },
      },
      firewallProfiles: {
        include: { rules: true },
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      },
    },
  });
}

export async function listServersForActor(orgId: string) {
  return prisma.vpsServer.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getServerProviderContext(serverId: string, orgId: string) {
  return prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: {
      id: true,
      providerSlug: true,
      providerServerId: true,
      instanceId: true,
      publicIpv4: true,
      name: true,
    },
  });
}

export function getPrimaryProviderBinding(server: {
  providerSlug: string;
  providerServerId: string | null;
  providerBindings: ProviderBindingLike[];
}) {
  const exactMatch = server.providerBindings.find(
    (binding) => binding.providerSlug === server.providerSlug
      && binding.providerServerId === server.providerServerId,
  );

  const preferredBinding = exactMatch
    || [...server.providerBindings].sort((left, right) => {
      const syncOrder = compareDatesDescending(left.lastSyncedAt, right.lastSyncedAt);
      if (syncOrder !== 0) {
        return syncOrder;
      }

      return compareDatesDescending(left.updatedAt, right.updatedAt);
    })[0];

  return preferredBinding
    || (server.providerServerId
      ? {
        providerSlug: server.providerSlug,
        providerServerId: server.providerServerId,
        providerRegionId: null,
        providerPlanId: null,
        metadataJson: null,
      }
      : null);
}

export function getActiveFirewallProfile<T extends FirewallProfileLike>(profiles: T[]) {
  return profiles.find((profile) => profile.isActive)
    || [...profiles].sort((left, right) => compareDatesDescending(left.updatedAt, right.updatedAt))[0]
    || null;
}
