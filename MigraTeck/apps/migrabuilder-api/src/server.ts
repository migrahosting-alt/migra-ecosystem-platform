import { buildApp } from "./app.js";
import { config } from "./config/env.js";

async function start(): Promise<void> {
  const app = await buildApp();

  await app.listen({ host: config.host, port: config.port });
  console.log(`migrabuilder-api listening on ${config.host}:${config.port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
