import { EntitlementStatus, ProductKey } from "@prisma/client";
import { DownloadsCenter } from "@/components/app/downloads-center";
import { isEntitlementRuntimeAllowed } from "@/lib/entitlements";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isInternalOrg } from "@/lib/security/internal-org";

export default async function DownloadsPage() {
  const session = await requireAuthSession();
  const activeMembership = await getActiveOrgContext(session.user.id);

  if (!activeMembership) {
    return <p>No active organization found.</p>;
  }

  const [artifacts, entitlements] = await Promise.all([
    prisma.downloadArtifact.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ product: "asc" }, { createdAt: "desc" }],
    }),
    prisma.orgEntitlement.findMany({
      where: {
        orgId: activeMembership.orgId,
      },
      select: {
        product: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    }),
  ]);

  const entitlementMap = new Map(entitlements.map((row) => [row.product, row]));
  const internalOrg = isInternalOrg(activeMembership.org);

  const rows = artifacts.map((artifact) => {
    const entitlement = entitlementMap.get(artifact.product);
    const entitlementStatus = entitlement?.status || EntitlementStatus.RESTRICTED;
    const statusAllowed = isEntitlementRuntimeAllowed(
      {
        status: entitlementStatus,
        startsAt: entitlement?.startsAt || null,
        endsAt: entitlement?.endsAt || null,
        allowInternal: true,
        isInternalOrg: internalOrg,
      },
      activeMembership.role,
    );
    const clientAllowed =
      artifact.product !== ProductKey.MIGRAPANEL ||
      activeMembership.org.isMigraHostingClient ||
      activeMembership.role === "OWNER";

    return {
      id: artifact.id,
      name: artifact.name,
      product: artifact.product,
      version: artifact.version,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes.toString(),
      entitled: statusAllowed && clientAllowed,
      entitlementStatus,
      reason: !clientAllowed
        ? "MIGRAPANEL_CLIENT_ONLY"
        : statusAllowed
          ? null
          : entitlementStatus === EntitlementStatus.INTERNAL_ONLY
            ? "INTERNAL_ONLY"
            : "ENTITLEMENT_REQUIRED",
    };
  });

  return <DownloadsCenter orgName={activeMembership.org.name} artifacts={rows} />;
}
