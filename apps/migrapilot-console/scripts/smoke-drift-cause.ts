// Smoke mode: deterministic single-cycle run, no hanging processes
process.env.AUTONOMY_SMOKE_MODE = "1";

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { readAutonomyState } from "../lib/autonomy/store";
import { createMission } from "../lib/mission/store";
import type { MissionRecord } from "../lib/mission/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(start = 7810): Promise<number> {
  let candidate = start;
  while (candidate < start + 200) {
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(candidate, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });

    if (free) {
      return candidate;
    }
    candidate += 1;
  }

  throw new Error("Unable to allocate free port for drift-cause smoke");
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
    await sleep(300);
  }
  return false;
}

function startServerRunner(input: {
  port: number;
  inventoryPath: string;
  journalPath: string;
  appRoot: string;
}): ChildProcess {
  const runnerDir = path.resolve(input.appRoot, "../migrapilot-runner-server");
  return spawn("npm", ["run", "dev"], {
    cwd: runnerDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(input.port),
      MIGRAPILOT_INVENTORY_PATH: input.inventoryPath,
      MIGRAPILOT_JOURNAL_PATH: input.journalPath
    }
  });
}

function writeInventory(filePath: string, variant: "baseline" | "drifted"): void {
  const baseline = {
    generatedAt: new Date().toISOString(),
    environment: "prod",
    tenants: [
      { tenantId: "tenant-a", name: "Tenant A", status: "active", classification: "client" },
      { tenantId: "tenant-b", name: "Tenant B", status: "active", classification: "client" },
      { tenantId: "migrateck", name: "MigraTeck", status: "active", classification: "internal" }
    ],
    pods: [
      { podId: "pod-a", tenantId: "tenant-a", status: "running", classification: "client" },
      { podId: "pod-b", tenantId: "tenant-b", status: "running", classification: "client" }
    ],
    domains: [
      { domain: "alpha.example.com", tenantId: "tenant-a", podId: "pod-a", classification: "client" },
      { domain: "beta.example.com", tenantId: "tenant-b", podId: "pod-b", classification: "client" }
    ],
    services: [
      { serviceId: "pve", type: "proxmox", classification: "internal" },
      { serviceId: "db-core", type: "postgres", classification: "internal" }
    ],
    topology: {
      edges: [
        { from: "pve", to: "db-core", type: "network" }
      ]
    },
    secretRefs: [
      { name: "postgres_main", ref: "vault:kv/migra/db-core", scope: "server" }
    ]
  };

  const drifted = {
    ...baseline,
    generatedAt: new Date().toISOString(),
    domains: [
      { domain: "alpha.example.com", tenantId: "tenant-b", podId: "pod-b", classification: "client" },
      { domain: "beta.example.com", tenantId: "tenant-b", podId: "pod-b", classification: "client" }
    ]
  };

  fs.writeFileSync(filePath, JSON.stringify(variant === "baseline" ? baseline : drifted, null, 2), "utf8");
}

async function captureSnapshot(note: string) {
  const { POST } = await import("../app/api/drift/snapshot/route");
  const response = await POST(
    new Request("http://localhost/api/drift/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        environment: "prod",
        classification: "all",
        note
      })
    })
  );

  return (await response.json()) as {
    ok: boolean;
    data?: {
      snapshotId: string;
      previousSnapshotId: string | null;
      severity: "info" | "warn" | "critical" | null;
    };
    error?: { message?: string };
  };
}

async function fetchDiff(from: string, to: string) {
  const { GET } = await import("../app/api/drift/diff/route");
  const response = await GET(new Request(`http://localhost/api/drift/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
  return (await response.json()) as {
    ok: boolean;
    data?: {
      diff: {
        diff: {
          summary: {
            severity: "info" | "warn" | "critical";
          };
          correlation?: {
            best?: {
              missionId?: string;
              score: number;
            };
          };
        };
      };
    };
    error?: {
      message?: string;
    };
  };
}

function createCorrelatedMission(nowIso: string): MissionRecord {
  return {
    missionId: "mission_smoke_drift_cause",
    createdAt: nowIso,
    updatedAt: nowIso,
    goal: "Move alpha.example.com from tenant-a to tenant-b during DNS correction",
    context: {
      notes: "Tenant migration impacted alpha.example.com and tenant-b",
      repoRoot: "."
    },
    operator: {
      operatorId: "smoke",
      role: "owner"
    },
    environment: "prod",
    runnerPolicy: {
      default: "server",
      allowServer: true
    },
    runIdBase: "run_mission_smoke_drift_cause",
    status: "completed",
    planner: "rule",
    origin: {
      source: "manual"
    },
    tasks: [
      {
        taskId: "task_dns",
        lane: "ops",
        title: "Adjust domain mapping",
        intent: "Move alpha.example.com from tenant-a to tenant-b",
        deps: [],
        toolCalls: [
          {
            toolName: "dns.update",
            input: {
              domain: "alpha.example.com",
              fromTenantId: "tenant-a",
              toTenantId: "tenant-b"
            },
            runnerTarget: "server",
            environment: "prod"
          }
        ],
        status: "done",
        retries: 0,
        maxRetries: 1,
        outputsRefs: [
          {
            jobId: "job_drift_smoke",
            journalEntryId: "journal_drift_smoke",
            toolName: "dns.update",
            runId: "run_mission_smoke_drift_cause_task_dns_1"
          }
        ]
      }
    ],
    toolRuns: [
      {
        id: "runrec_drift_smoke",
        missionId: "mission_smoke_drift_cause",
        taskId: "task_dns",
        toolName: "dns.update",
        runnerUsed: "server",
        env: "prod",
        baseTier: 2,
        effectiveTier: 2,
        jobId: "job_drift_smoke",
        journalEntryId: "journal_drift_smoke",
        ok: true,
        runId: "run_mission_smoke_drift_cause_task_dns_1",
        createdAt: nowIso
      }
    ],
    notes: ["smoke mission seeded for drift root-cause test"]
  };
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(scriptDir, "..");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "migrapilot-drift-cause-smoke-"));
  const inventoryPath = path.join(tempRoot, "inventory.json");
  const journalPath = path.join(tempRoot, "journal.ndjson");
  const runnerPort = await getFreePort();
  const runnerUrl = `http://127.0.0.1:${runnerPort}`;

  process.env.MIGRAPILOT_SERVER_RUNNER_URL = runnerUrl;
  process.env.MIGRAPILOT_JOB_SIGNING_KEY = process.env.MIGRAPILOT_JOB_SIGNING_KEY ?? "dev-smoke-signing-key";

  writeInventory(inventoryPath, "baseline");

  const runner = startServerRunner({
    port: runnerPort,
    inventoryPath,
    journalPath,
    appRoot
  });

  try {
    const ready = await waitForRunner(runnerUrl, 25000);
    if (!ready) {
      throw new Error("Server runner did not become healthy in time");
    }

    const first = await captureSnapshot("baseline");
    if (!first.ok || !first.data) {
      throw new Error(first.error?.message ?? "Baseline snapshot failed");
    }

    const missionTs = new Date().toISOString();
    createMission(createCorrelatedMission(missionTs));

    writeInventory(inventoryPath, "drifted");
    await sleep(2300);

    const second = await captureSnapshot("drifted");
    if (!second.ok || !second.data) {
      throw new Error(second.error?.message ?? "Drift snapshot failed");
    }

    if (second.data.severity !== "critical") {
      throw new Error(`Expected critical drift severity, received ${second.data.severity ?? "none"}`);
    }

    const diffPayload = await fetchDiff(first.data.snapshotId, second.data.snapshotId);
    if (!diffPayload.ok || !diffPayload.data) {
      throw new Error(diffPayload.error?.message ?? "Failed to load drift diff payload");
    }

    const best = diffPayload.data.diff.diff.correlation?.best;
    if (!best) {
      throw new Error("Expected correlation best candidate");
    }
    if (best.missionId !== "mission_smoke_drift_cause") {
      throw new Error(`Expected best mission to be mission_smoke_drift_cause, received ${best.missionId ?? "none"}`);
    }
    if (best.score < 0.55) {
      throw new Error(`Expected best correlation score >= 0.55, received ${best.score}`);
    }

    const autonomyState = readAutonomyState();
    const driftFinding = autonomyState.findings.find((finding) => finding.title.includes("Drift detected"));
    if (!driftFinding) {
      throw new Error("Expected drift finding in autonomy state");
    }

    let parsedDetails: Record<string, unknown> = {};
    try {
      parsedDetails = JSON.parse(driftFinding.details) as Record<string, unknown>;
    } catch {
      parsedDetails = {};
    }

    const likelyCause = parsedDetails.likelyCause as Record<string, unknown> | undefined;
    if (!likelyCause || likelyCause.missionId !== "mission_smoke_drift_cause") {
      throw new Error("Expected drift finding to include likelyCause mission reference");
    }

    console.log("Drift-cause smoke passed");
    console.log(`snapshot=${second.data.snapshotId}`);
    console.log(`bestMission=${best.missionId}`);
    console.log(`score=${best.score}`);
  } finally {
    if (!runner.killed) {
      runner.kill("SIGTERM");
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Drift-cause smoke failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
