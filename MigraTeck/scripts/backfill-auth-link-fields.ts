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
    },
  });

  for (const user of users) {
    const normalized = normalizeEmail(user.email);
    if (!normalized || user.emailNormalized === normalized) {
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailNormalized: normalized },
    });
  }

  const duplicates = await prisma.$queryRaw<
    Array<{ emailNormalized: string; count: bigint }>
  >`
    SELECT "emailNormalized", COUNT(*)::bigint as count
    FROM "User"
    WHERE "emailNormalized" IS NOT NULL
    GROUP BY "emailNormalized"
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length > 0) {
    console.error("Duplicate normalized emails found:");
    console.table(
      duplicates.map((duplicate) => ({
        emailNormalized: duplicate.emailNormalized,
        count: Number(duplicate.count),
      })),
    );
    process.exitCode = 1;
    return;
  }

  console.log("Backfill complete. No duplicate normalized emails found.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
