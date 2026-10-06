import { closeDb } from "./lib/db.js";
import { processWebhookBatch } from "./lib/webhooks.js";

let stopping = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("[migrateck-webhook-worker] started");

  while (!stopping) {
    try {
      const processed = await processWebhookBatch(20);
      await sleep(processed > 0 ? 500 : 4_000);
    } catch (error) {
      console.error("[migrateck-webhook-worker] batch failed", error);
      await sleep(5_000);
    }
  }

  await closeDb();
  console.log("[migrateck-webhook-worker] stopped");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

main().catch((error) => {
  console.error("[migrateck-webhook-worker] fatal", error);
  process.exit(1);
});
