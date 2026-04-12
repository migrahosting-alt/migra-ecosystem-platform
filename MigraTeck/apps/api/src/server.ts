import { buildApiApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

async function start(): Promise<void> {
  const app = await buildApiApp();

  await app.listen({
    host,
    port,
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
