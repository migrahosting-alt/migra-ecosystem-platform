import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

interface StartAppInput {
  port: number;
  env: NodeJS.ProcessEnv;
}

export interface AppServerHandle {
  baseUrl: string;
  stop: () => Promise<void>;
}

async function waitForServer(baseUrl: string, timeoutMs = 120_000): Promise<void> {
  const startedAt = Date.now();
  const target = `${baseUrl}/api/products/consume`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(target, { method: "GET" });
      if (response.status < 500) {
        return;
      }
    } catch {
      // Server is still booting.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for Next app at ${target}`);
}

export async function startAppServer(input: StartAppInput): Promise<AppServerHandle> {
  const projectRoot = path.resolve(__dirname, "../..");
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${input.port}`;

  const child = spawn("pnpm", ["exec", "next", "dev", "--webpack", "--hostname", host, "--port", String(input.port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...input.env,
    },
    stdio: "inherit",
  });

  await waitForServer(baseUrl);

  return {
    baseUrl,
    stop: async () => {
      if (child.killed || child.exitCode !== null) {
        return;
      }

      child.kill("SIGTERM");

      const startedAt = Date.now();
      while (child.exitCode === null && Date.now() - startedAt < 10_000) {
        await sleep(100);
      }

      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    },
  };
}
