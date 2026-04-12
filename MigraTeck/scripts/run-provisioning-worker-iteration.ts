import { prisma } from "@/lib/prisma";
import { processProvisioningQueue } from "../workers/provisioning-engine";

async function main() {
  const processed = await processProvisioningQueue();
  console.log(JSON.stringify({ processed }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
