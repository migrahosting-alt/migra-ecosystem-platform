import { PrismaClient, OrgRole, ProductKey, EntitlementStatus } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

async function main() {
  const ownerEmail = process.env.MIGRATECK_SEED_OWNER_EMAIL || "owner@migrateck.com";
  const ownerEmailNormalized = ownerEmail.trim().toLowerCase();
  const ownerName = process.env.MIGRATECK_SEED_OWNER_NAME || "MigraTeck Owner";
  const ownerAuthUserId = process.env.MIGRATECK_SEED_OWNER_AUTH_USER_ID || `seed:${ownerEmailNormalized}`;
  const orgName = process.env.MIGRATECK_SEED_ORG_NAME || "MigraTeck Enterprise";
  const orgSlug = process.env.MIGRATECK_SEED_ORG_SLUG || slugify(orgName);
  const isClient = process.env.MIGRATECK_SEED_IS_CLIENT === "true";
  const seedProduct = (process.env.MIGRATECK_SEED_PRODUCT || "MIGRAPANEL").toUpperCase();

  if (!Object.values(ProductKey).includes(seedProduct)) {
    throw new Error(`Invalid MIGRATECK_SEED_PRODUCT: ${seedProduct}`);
  }

  const user = await prisma.user.upsert({
    where: { email: ownerEmailNormalized },
    update: {
      name: ownerName,
      authUserId: ownerAuthUserId,
      emailNormalized: ownerEmailNormalized,
      emailVerified: new Date(),
    },
    create: {
      name: ownerName,
      email: ownerEmailNormalized,
      emailNormalized: ownerEmailNormalized,
      authUserId: ownerAuthUserId,
      emailVerified: new Date(),
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {
      name: orgName,
      isMigraHostingClient: isClient,
      createdById: user.id,
    },
    create: {
      name: orgName,
      slug: orgSlug,
      isMigraHostingClient: isClient,
      createdById: user.id,
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_orgId: {
        userId: user.id,
        orgId: org.id,
      },
    },
    update: {
      role: OrgRole.OWNER,
      status: "ACTIVE",
    },
    create: {
      userId: user.id,
      orgId: org.id,
      role: OrgRole.OWNER,
      status: "ACTIVE",
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { defaultOrgId: org.id },
  });

  await prisma.orgEntitlement.upsert({
    where: {
      orgId_product: {
        orgId: org.id,
        product: seedProduct,
      },
    },
    update: {
      status: EntitlementStatus.ACTIVE,
    },
    create: {
      orgId: org.id,
      product: seedProduct,
      status: EntitlementStatus.ACTIVE,
    },
  });

  const existingArtifact = await prisma.downloadArtifact.findFirst({
    where: {
      product: seedProduct,
      version: "1.0.0",
      fileKey: `${seedProduct.toLowerCase()}/releases/1.0.0/package.tar.gz`,
    },
    select: { id: true },
  });

  if (!existingArtifact) {
    await prisma.downloadArtifact.create({
      data: {
        name: `${seedProduct} Artifact`,
        product: seedProduct,
        version: "1.0.0",
        fileKey: `${seedProduct.toLowerCase()}/releases/1.0.0/package.tar.gz`,
        sha256: "seed-placeholder-sha256",
        sizeBytes: BigInt(1024 * 1024 * 42),
        isActive: true,
      },
    });
  }

  await prisma.platformConfig.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      allowPublicSignup: true,
      allowOrgCreate: true,
      waitlistMode: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      orgId: org.id,
      action: "SEED_BOOTSTRAP_COMPLETED",
      entityType: "seed",
      entityId: org.id,
      metadata: {
        ownerEmail,
        orgSlug,
        seedProduct,
      },
    },
  });

  console.log(`Seed complete for ${ownerEmail} in org ${org.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
