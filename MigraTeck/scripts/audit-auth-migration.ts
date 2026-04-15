import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      emailNormalized: true,
      authUserId: true,
      passwordHash: true,
    },
  });

  const missingEmail = users.filter((user) => !normalizeEmail(user.email));
  const missingNormalized = users.filter((user) => !user.emailNormalized);
  const alreadyLinked = users.filter((user) => Boolean(user.authUserId));
  const localOnly = users.filter((user) => !user.authUserId && Boolean(user.passwordHash));

  const duplicateMap = new Map<string, string[]>();
  for (const user of users) {
    const normalized = normalizeEmail(user.email);
    if (!normalized) {
      continue;
    }

    const ids = duplicateMap.get(normalized) ?? [];
    ids.push(user.id);
    duplicateMap.set(normalized, ids);
  }

  const duplicates = [...duplicateMap.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([email, ids]) => ({ email, ids }));

  console.log("=== Auth Migration Audit ===");
  console.log("Total users:", users.length);
  console.log("Already linked:", alreadyLinked.length);
  console.log("Local-only auth users:", localOnly.length);
  console.log("Missing email:", missingEmail.length);
  console.log("Missing normalized email:", missingNormalized.length);
  console.log("Duplicate normalized emails:", duplicates.length);

  if (duplicates.length > 0) {
    console.log("\nDuplicate email groups:");
    for (const duplicate of duplicates) {
      console.log(`- ${duplicate.email}: ${duplicate.ids.join(", ")}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
