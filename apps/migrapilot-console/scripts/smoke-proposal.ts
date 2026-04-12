// Smoke mode: deterministic single-cycle run, no hanging processes
process.env.AUTONOMY_SMOKE_MODE = "1";

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import net from "node:net";

import { listActivity } from "../lib/activity/store";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(start = 7850): Promise<number> {
  let candidate = start;
  while (candidate < start + 200) {
    const isFree = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(candidate, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (isFree) return candidate;
    candidate += 1;
  }
  throw new Error(`No free port found starting at ${start}`);
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForRunner(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return true;
    await sleep(400);
  }
  return false;
}

async function invokeStartMission(goal: string, propose: boolean, windowSecs: number) {
  const { POST } = await import("../app/api/mission/start/route");
  const res = await POST(
    new Request("http://localhost/api/mission/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal,
        context: {},
        runnerPolicy: { default: "local", allowServer: false },
        environment: "dev",
        operator: { operatorId: "smoke-proposal", role: "ops" },
        origin: { source: "manual" },
        proposeBeforeExecute: propose,
        proposalWindowSecs: windowSecs,
        analysis: propose
          ? {
              likelyCause: "smoke-test simulated root cause",
              confidence: 0.85,
              riskLevel: "low" as const,
              recommendedAction: "proceed",
              impactSummary: "No real impact — smoke test"
            }
          : undefined
      })
    })
  );
  return (await res.json()) as { ok: boolean; data?: { missionId: string; analysis: unknown; proposalExpiresAt: string }; error?: { message?: string } };
}

async function invokeGetMission(missionId: string) {
  const { GET } = await import("../app/api/mission/[missionId]/route");
  const res = await GET(new Request(`http://localhost/api/mission/${missionId}`), {
    params: Promise.resolve({ missionId })
  });
  return (await res.json()) as { ok: boolean; data?: { missionId: string; status: string; analysis: unknown }; error?: { message?: string } };
}

async function invokeExecuteNow(missionId: string) {
  const { POST } = await import("../app/api/mission/executeNow/route");
  const res = await POST(
    new Request("http://localhost/api/mission/executeNow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId })
    })
  );
  return (await res.json()) as { ok: boolean; data?: { mission: { missionId: string; status: string } }; error?: { message?: string } };
}

async function invokeModify(missionId: string) {
  const { POST } = await import("../app/api/mission/modify/route");
  const res = await POST(
    new Request("http://localhost/api/mission/modify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        missionId,
        environmentOverride: "dev",
        proposalWindowSecs: 60,
        dryRun: true
      })
    })
  );
  return (await res.json()) as { ok: boolean; data?: { mission: { missionId: string; status: string; dryRun?: boolean } }; error?: { message?: string } };
}

async function main(): Promise<void> {
  const port = await getFreePort(7850);
  const runnerUrl = `http://127.0.0.1:${port}`;
  process.env.MIGRAPILOT_LOCAL_RUNNER_URL = runnerUrl;
  process.env.MIGRAPILOT_JOB_SIGNING_KEY ??= "dev-smoke-signing-key";

  const runnerDir = path.resolve(process.cwd(), "../migrapilot-runner-local");
  let runner: ChildProcess | null = null;

  const alreadyUp = await isHealthy(runnerUrl);
  if (!alreadyUp) {
    runner = spawn("npm", ["run", "dev"], {
      cwd: runnerDir,
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) }
    });
    const ready = await waitForRunner(runnerUrl, 25000);
    if (!ready) {
      throw new Error(`Local runner did not become healthy on port ${port}`);
    }
  }

  try {
    // ----------------------------------------------------------------
    // Test 1: Start mission with proposeBeforeExecute = true
    // ----------------------------------------------------------------
    const startRes = await invokeStartMission(
      "Smoke: investigate and remediate elevated error rate in pod migra-web-1",
      true,
      120
    );
    if (!startRes.ok || !startRes.data?.missionId) {
      throw new Error(startRes.error?.message ?? "Mission start failed");
    }
    const { missionId } = startRes.data;

    // ----------------------------------------------------------------
    // Test 2: Verify mission.status === "proposed"
    // ----------------------------------------------------------------
    const getRes = await invokeGetMission(missionId);
    if (!getRes.ok || !getRes.data) {
      throw new Error(getRes.error?.message ?? "Mission get failed");
    }
    if (getRes.data.status !== "proposed") {
      throw new Error(`Expected status=proposed, got: ${getRes.data.status}`);
    }
    if (!getRes.data.analysis) {
      throw new Error("Expected analysis to be set on proposed mission");
    }

    // ----------------------------------------------------------------
    // Test 3: Modify plan (governance validation)
    // ----------------------------------------------------------------
    const modifyRes = await invokeModify(missionId);
    if (!modifyRes.ok) {
      throw new Error(modifyRes.error?.message ?? "Modify failed");
    }
    if (modifyRes.data?.mission.status !== "proposed") {
      throw new Error(`Expected status=proposed after modify, got: ${modifyRes.data?.mission.status}`);
    }
    if (!modifyRes.data.mission.dryRun) {
      throw new Error("Expected dryRun=true after modify");
    }

    // ----------------------------------------------------------------
    // Test 4: Execute now — transition to running/completed
    // ----------------------------------------------------------------
    await sleep(300);
    const execRes = await invokeExecuteNow(missionId);
    if (!execRes.ok) {
      throw new Error(execRes.error?.message ?? "executeNow failed");
    }
    const finalStatus = execRes.data?.mission.status;
    const validStatuses = ["running", "completed", "failed", "awaiting_approval", "pending"];
    if (!validStatuses.includes(finalStatus ?? "")) {
      throw new Error(`Expected running/completed after executeNow, got: ${finalStatus}`);
    }

    // ----------------------------------------------------------------
    // Test 5: Assert proposal_confirmed activity event was emitted
    // ----------------------------------------------------------------
    await sleep(200);
    const activities = listActivity(50);
    const proposedEvent = activities.find((e) => e.kind === "mission_proposed" && e.missionId === missionId);
    if (!proposedEvent) {
      throw new Error(`Expected mission_proposed activity event for ${missionId}`);
    }
    const confirmedEvent = activities.find((e) => e.kind === "proposal_confirmed" && e.missionId === missionId);
    if (!confirmedEvent) {
      throw new Error(`Expected proposal_confirmed activity event for ${missionId}`);
    }

    console.log("Proposal smoke passed");
    console.log(`missionId=${missionId}`);
    console.log(`finalStatus=${finalStatus}`);
    console.log(`activityEvents=${activities.length}`);
  } finally {
    if (runner && !runner.killed) {
      runner.kill("SIGTERM");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Proposal smoke failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
