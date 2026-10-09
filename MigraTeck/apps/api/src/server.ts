import { buildApiApp } from "./app.js";
import { syncCatalogMirrorIfAvailable } from "./lib/catalog-mirror.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

async function start(): Promise<void> {
  const app = await buildApiApp();

  try {
    const catalogMirror = await syncCatalogMirrorIfAvailable();
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        scope: "catalog-mirror",
        level: "info",
        result: catalogMirror.reason,
        synced: catalogMirror.synced,
        skipped: catalogMirror.skipped,
      }),
    );
  } catch (error) {
    // The catalog mirror is an observability/runtime-index layer, not a
    // prerequisite for serving identity, billing, or entitlement APIs.
    // Surface the failure loudly without taking the whole control plane down.
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        scope: "catalog-mirror",
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unknown catalog mirror startup failure",
      }),
    );
  }

  await app.listen({
    host,
    port,
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
