// Smoke mode: deterministic single-cycle run, no hanging processes
process.env.AUTONOMY_SMOKE_MODE = "1";

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { TEMPLATE_REPO_LARGE_DIFF_REVIEW } from "../lib/autonomy/templates";

const LOCAL_RUNNER_URL = process.env.MIGRAPILOT_LOCAL_RUNNER_URL ?? "http://127.0.0.1:7788";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isRunnerHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForRunner(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRunnerHealthy(url)) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

function startLocalRunner(): ChildProcess {
  const runnerDir = path.resolve(process.cwd(), "../migrapilot-runner-local");
  return spawn("npm", ["run", "dev"], {
    cwd: runnerDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "7788"
    }
  });
}

async function invokeConfig(config: unknown) {
  const { POST } = await import("../app/api/autonomy/config/route");
  const response = await POST(
    new Request("http://localhost/api/autonomy/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config })
    })
  );
  return (await response.json()) as { ok: boolean; error?: { message?: string } };
}

async function invokeRunOnce(seedFindings: unknown[]) {
  const { POST } = await import("../app/api/autonomy/runOnce/route");
  const response = await POST(
    new Request("http://localhost/api/autonomy/runOnce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seedFindings })
    })
  );
  return (await response.json()) as {
    ok: boolean;
    data?: {
      processedItems: number;
      status: {
        enabled: boolean;
      };
    };
    error?: { message?: string };
  };
}

async function invokeQueue() {
  const { GET } = await import("../app/api/autonomy/queue/route");
  const response = await GET(new Request("http://localhost/api/autonomy/queue?limit=200"));
  return (await response.json()) as {
    ok: boolean;
    data?: {
      queue: Array<{
        queueId: string;
        status: string;
        outputsRefs: Array<{ journalEntryId?: string }>;
      }>;
    };
  };
}

async function main(): Promise<void> {
  process.env.MIGRAPILOT_LOCAL_RUNNER_URL = LOCAL_RUNNER_URL;
  process.env.MIGRAPILOT_JOB_SIGNING_KEY = process.env.MIGRAPILOT_JOB_SIGNING_KEY ?? "dev-smoke-signing-key";

  let startedRunner: ChildProcess | null = null;
  const alreadyUp = await isRunnerHealthy(LOCAL_RUNNER_URL);
  if (!alreadyUp) {
    startedRunner = startLocalRunner();
    const ready = await waitForRunner(LOCAL_RUNNER_URL, 25000);
    if (!ready) {
      throw new Error("Local runner did not become healthy in time");
    }
  }

  try {
    const configResult = await invokeConfig({
      enabled: true,
      runnerPolicy: {
        allowServer: false,
        defaultRunnerTarget: "local"
      },
      environmentPolicy: {
        defaultEnv: "dev",
        prodAllowed: false
      },
      budgets: {
        missionsPerHour: 4,
        tier2PerDay: 1,
        maxWritesPerMission: 3,
        maxFailuresPerHour: 5,
        maxAffectedTenantsPerMission: 2
      },
      confidenceGate: {
        minConfidenceToContinue: 0.5,
        decayOnFailure: 0.15,
        decayOnRetry: 0.05
      }
    });

    if (!configResult.ok) {
      throw new Error(configResult.error?.message ?? "Failed to configure autonomy");
    }

    const seed = {
      source: "repo",
      severity: "warn",
      title: "Smoke: repository drift requires review",
      details: "seeded finding for autonomy smoke",
      suggestedMissionTemplateId: TEMPLATE_REPO_LARGE_DIFF_REVIEW
    };

    const firstRun = await invokeRunOnce([seed]);
    if (!firstRun.ok) {
      throw new Error(firstRun.error?.message ?? "runOnce failed");
    }

    await sleep(1500);
    const secondRun = await invokeRunOnce([]);
    if (!secondRun.ok) {
      throw new Error(secondRun.error?.message ?? "second runOnce failed");
    }

    const queue = await invokeQueue();
    if (!queue.ok || !queue.data) {
      throw new Error("Queue endpoint failed");
    }

    const queueItems = queue.data.queue;
    if (queueItems.length === 0) {
      throw new Error("Autonomy queue is empty after seeded run");
    }

    const itemWithJournal = queueItems.find((item) => item.outputsRefs.some((ref) => Boolean(ref.journalEntryId)));
    if (!itemWithJournal) {
      throw new Error("No autonomy queue item captured journalEntryId output refs");
    }

    console.log("Autonomy smoke passed");
    console.log(`queueItems=${queueItems.length}`);
    console.log(`journalRefs=${itemWithJournal.outputsRefs.filter((ref) => ref.journalEntryId).length}`);
  } finally {
    if (startedRunner && !startedRunner.killed) {
      startedRunner.kill("SIGTERM");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Autonomy smoke failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
