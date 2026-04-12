// Smoke mode: deterministic single-cycle run, no hanging processes
process.env.AUTONOMY_SMOKE_MODE = "1";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { readAutonomyState } from "../lib/autonomy/store";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(start = 7790): Promise<number> {
  let candidate = start;
  while (candidate < start + 200) {
    const isFree = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(candidate, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (isFree) {
      return candidate;
    }
    candidate += 1;
  }
  throw new Error("Unable to allocate free port for drift smoke");
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
}): ChildProcess {
  const runnerDir = path.resolve(process.cwd(), "../migrapilot-runner-server");
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
    ],
    services: [
      { serviceId: "pve", type: "proxmox", classification: "internal" }
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
      diffSummary: {
        severity: "info" | "warn" | "critical";
      } | null;
    };
    error?: {
      message?: string;
    };
  };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "migrapilot-drift-smoke-"));
  const inventoryPath = path.join(tempRoot, "inventory.json");
  const journalPath = path.join(tempRoot, "journal.ndjson");
  const runnerPort = await getFreePort();
  const runnerUrl = `http://127.0.0.1:${runnerPort}`;

  writeInventory(inventoryPath, "baseline");

  process.env.MIGRAPILOT_SERVER_RUNNER_URL = runnerUrl;
  process.env.MIGRAPILOT_JOB_SIGNING_KEY = process.env.MIGRAPILOT_JOB_SIGNING_KEY ?? "dev-smoke-signing-key";

  const runner = startServerRunner({
    port: runnerPort,
    inventoryPath,
    journalPath
  });

  try {
    const ready = await waitForRunner(runnerUrl, 25000);
    if (!ready) {
      throw new Error("Server runner did not become healthy in time");
    }

    const first = await captureSnapshot("baseline");
    if (!first.ok || !first.data) {
      throw new Error(first.error?.message ?? "First snapshot failed");
    }

    writeInventory(inventoryPath, "drifted");
    await sleep(2300);

    const second = await captureSnapshot("drifted");
    if (!second.ok || !second.data) {
      throw new Error(second.error?.message ?? "Second snapshot failed");
    }

    if (!second.data.diffSummary) {
      throw new Error("Expected diff summary from second snapshot");
    }

    if (second.data.diffSummary.severity !== "critical") {
      throw new Error(`Expected critical drift severity, received ${second.data.diffSummary.severity}`);
    }

    const autonomyState = readAutonomyState();
    const finding = autonomyState.findings.find((entry) => {
      const ts = Date.parse(entry.ts);
      return ts >= startedAt && entry.title.includes("Drift detected") && entry.severity === "critical";
    });

    if (!finding) {
      throw new Error("Expected critical drift finding in autonomy store");
    }

    console.log("Drift smoke passed");
    console.log(`snapshot=${second.data.snapshotId}`);
    console.log(`severity=${second.data.diffSummary.severity}`);
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
    console.error("Drift smoke failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
