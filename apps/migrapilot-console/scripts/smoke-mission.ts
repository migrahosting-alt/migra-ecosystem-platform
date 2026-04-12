// Smoke mode: deterministic single-cycle run, no hanging processes
process.env.AUTONOMY_SMOKE_MODE = "1";

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { startMission, stepMission } from "../lib/mission/service";

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
    const started = await startMission({
      goal: "Find overflow CSS issue and propose a patch",
      context: {
        focusFile: "src/server.ts",
        notes: "smoke mission"
      },
      runnerPolicy: {
        default: "local",
        allowServer: false
      },
      environment: "dev",
      operator: {
        operatorId: "smoke-operator",
        role: "owner"
      }
    });

    if (started.nextRunnableTasks.length === 0) {
      throw new Error("Mission started without runnable tasks");
    }

    const missionId = started.mission.missionId;
    const afterFirstStep = await stepMission({
      missionId,
      maxTasks: 2
    });
    const afterSecondStep = await stepMission({
      missionId,
      maxTasks: 2
    });

    const runs = afterSecondStep.toolRuns.filter((run) => run.taskId !== "qa_autocheck");
    if (runs.length < 2) {
      throw new Error(`Expected at least 2 tool runs, received ${runs.length}`);
    }

    const missingJournal = runs.find((run) => !run.journalEntryId);
    if (missingJournal) {
      throw new Error(`Missing journalEntryId for tool run ${missingJournal.toolName}`);
    }

    const validStatuses = new Set(["running", "pending", "awaiting_approval", "completed"]);
    if (!validStatuses.has(afterSecondStep.status)) {
      throw new Error(`Unexpected mission status ${afterSecondStep.status}`);
    }

    if (afterFirstStep.status === "failed" || afterSecondStep.status === "failed") {
      throw new Error(`Mission failed: ${afterSecondStep.lastError ?? afterFirstStep.lastError ?? "unknown error"}`);
    }

    console.log("Mission smoke passed");
    console.log(`missionId=${missionId}`);
    console.log(`toolRuns=${runs.length}`);
  } finally {
    if (startedRunner && !startedRunner.killed) {
      startedRunner.kill("SIGTERM");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Mission smoke failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
