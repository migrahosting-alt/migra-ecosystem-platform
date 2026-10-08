import type { Prisma, WorkforceProduct } from "../../prisma-client.js";

export type WorkforceProvisioningEventType =
  | "grant"
  | "revoke"
  | "expire"
  | "suspend"
  | "reactivate"
  | "terminate";

export type ProductSnapshot = {
  product: WorkforceProduct;
  roleKeys: string[];
  grantIds: string[];
};

const PROVISIONED_PRODUCTS = new Set<WorkforceProduct>(["FRENDELO"]);

export function supportsWorkforceProvisioning(
  product: WorkforceProduct,
): boolean {
  return PROVISIONED_PRODUCTS.has(product);
}

function uniqSorted(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort();
}

export async function activeProductSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    workforceProfileId: string;
    product: WorkforceProduct;
    now: Date;
  },
): Promise<ProductSnapshot> {
  const grants = await tx.workforceProductAccessGrant.findMany({
    where: {
      workforceProfileId: input.workforceProfileId,
      product: input.product,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
    },
    select: { id: true, roleKey: true },
  });

  return {
    product: input.product,
    roleKeys: uniqSorted(grants.map((grant) => grant.roleKey)),
    grantIds: uniqSorted(grants.map((grant) => grant.id)),
  };
}

export async function activeProvisionedProductSnapshots(
  tx: Prisma.TransactionClient,
  input: {
    workforceProfileId: string;
    now: Date;
  },
): Promise<ProductSnapshot[]> {
  const grants = await tx.workforceProductAccessGrant.findMany({
    where: {
      workforceProfileId: input.workforceProfileId,
      product: { in: [...PROVISIONED_PRODUCTS] },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
    },
    select: { id: true, product: true, roleKey: true },
  });

  const grouped = new Map<WorkforceProduct, ProductSnapshot>();
  for (const grant of grants) {
    const current = grouped.get(grant.product) ?? {
      product: grant.product,
      roleKeys: [],
      grantIds: [],
    };
    current.roleKeys.push(grant.roleKey);
    current.grantIds.push(grant.id);
    grouped.set(grant.product, current);
  }

  return [...grouped.values()]
    .map((snapshot) => ({
      ...snapshot,
      roleKeys: uniqSorted(snapshot.roleKeys),
      grantIds: uniqSorted(snapshot.grantIds),
    }))
    .sort((a, b) => a.product.localeCompare(b.product));
}

export async function enqueueWorkforceProvisioningSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    workforceProfileId: string;
    staffId: string;
    product: WorkforceProduct;
    eventType: WorkforceProvisioningEventType;
    entitlementRevision: number;
    productAccessActive: boolean;
    roleKeys: string[];
    grantIds: string[];
    relatedGrantIds?: string[];
  },
) {
  if (!supportsWorkforceProvisioning(input.product)) return null;

  const roleKeys = input.productAccessActive
    ? uniqSorted(input.roleKeys)
    : [];
  const grantIds = input.productAccessActive
    ? uniqSorted(input.grantIds)
    : [];
  const relatedGrantIds = uniqSorted([
    ...grantIds,
    ...(input.relatedGrantIds ?? []),
  ]);

  if (relatedGrantIds.length > 0) {
    await tx.workforceProductAccessGrant.updateMany({
      where: {
        workforceProfileId: input.workforceProfileId,
        id: { in: relatedGrantIds },
      },
      data: {
        provisioningState: "PENDING",
        lastProvisionError: null,
      },
    });
  }

  return tx.workforceProvisioningOutbox.create({
    data: {
      workforceProfileId: input.workforceProfileId,
      staffId: input.staffId,
      product: input.product,
      eventType: input.eventType,
      entitlementRevision: input.entitlementRevision,
      productAccessActive: input.productAccessActive && roleKeys.length > 0,
      roleKeys,
      grantIds,
      relatedGrantIds,
    },
  });
}
