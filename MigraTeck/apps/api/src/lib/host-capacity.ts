import { readdir, realpath, stat, statfs } from "node:fs/promises";
import { basename, join } from "node:path";
import { freemem, loadavg, totalmem } from "node:os";

export type CapacityState = "healthy" | "warning" | "critical";

export type HostCapacity = {
  state: CapacityState;
  checkedPath: string;
  disk: {
    totalBytes: number;
    availableBytes: number;
    usedBytes: number;
    usedPercent: number;
    warningPercent: number;
    criticalPercent: number;
    warningFreeBytes: number;
    criticalFreeBytes: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  loadAverage: {
    oneMinute: number;
    fiveMinutes: number;
    fifteenMinutes: number;
  };
  releases: {
    root: string;
    count: number;
    activePath: string | null;
    activeName: string | null;
    newest: Array<{
      name: string;
      modifiedAt: string;
    }>;
    error: string | null;
  };
  reasons: string[];
};

const GIB = 1024 ** 3;

function finiteNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function classifyDiskCapacity(input: {
  usedPercent: number;
  availableBytes: number;
  warningPercent?: number;
  criticalPercent?: number;
  warningFreeBytes?: number;
  criticalFreeBytes?: number;
}): { state: CapacityState; reasons: string[] } {
  const warningPercent = input.warningPercent ?? 90;
  const criticalPercent = input.criticalPercent ?? 95;
  const warningFreeBytes = input.warningFreeBytes ?? 10 * GIB;
  const criticalFreeBytes = input.criticalFreeBytes ?? 5 * GIB;
  const reasons: string[] = [];

  if (input.usedPercent >= criticalPercent) {
    reasons.push(
      `disk usage ${input.usedPercent.toFixed(1)}% >= critical threshold ${criticalPercent}%`,
    );
  }
  if (input.availableBytes <= criticalFreeBytes) {
    reasons.push(
      `free disk ${(input.availableBytes / GIB).toFixed(1)} GiB <= critical floor ${(
        criticalFreeBytes / GIB
      ).toFixed(1)} GiB`,
    );
  }
  if (reasons.length > 0) return { state: "critical", reasons };

  if (input.usedPercent >= warningPercent) {
    reasons.push(
      `disk usage ${input.usedPercent.toFixed(1)}% >= warning threshold ${warningPercent}%`,
    );
  }
  if (input.availableBytes <= warningFreeBytes) {
    reasons.push(
      `free disk ${(input.availableBytes / GIB).toFixed(1)} GiB <= warning floor ${(
        warningFreeBytes / GIB
      ).toFixed(1)} GiB`,
    );
  }

  return {
    state: reasons.length > 0 ? "warning" : "healthy",
    reasons,
  };
}

async function releaseInventory(): Promise<HostCapacity["releases"]> {
  const root =
    process.env.MIGRATECK_RELEASE_ROOT ?? "/opt/migra/releases/migrateck";
  const current =
    process.env.MIGRATECK_WEB_CURRENT_LINK ?? "/opt/migra/apps/migrateck/current";

  let activePath: string | null = null;
  try {
    activePath = await realpath(current);
  } catch {
    activePath = null;
  }

  try {
    const entries = await readdir(root, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    const detailed = await Promise.all(
      directories.map(async (entry) => {
        const itemPath = join(root, entry.name);
        try {
          const info = await stat(itemPath);
          return {
            name: entry.name,
            modifiedAt: info.mtime.toISOString(),
            modifiedAtMs: info.mtimeMs,
          };
        } catch {
          return {
            name: entry.name,
            modifiedAt: new Date(0).toISOString(),
            modifiedAtMs: 0,
          };
        }
      }),
    );

    detailed.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);

    return {
      root,
      count: detailed.length,
      activePath,
      activeName: activePath ? basename(activePath) : null,
      newest: detailed.slice(0, 8).map(({ name, modifiedAt }) => ({
        name,
        modifiedAt,
      })),
      error: null,
    };
  } catch (error) {
    return {
      root,
      count: 0,
      activePath,
      activeName: activePath ? basename(activePath) : null,
      newest: [],
      error:
        error instanceof Error ? error.message : "Release inventory unavailable",
    };
  }
}

export async function getHostCapacitySnapshot(): Promise<HostCapacity> {
  const checkedPath = process.env.MIGRATECK_CAPACITY_PATH ?? "/";
  const diskStats = await statfs(checkedPath, { bigint: true });

  const totalBytes = Number(diskStats.bsize * diskStats.blocks);
  const availableBytes = Number(diskStats.bsize * diskStats.bavail);
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const usedPercent =
    totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

  const warningPercent = finiteNumber(
    process.env.MIGRATECK_DISK_WARNING_PERCENT,
    90,
  );
  const criticalPercent = finiteNumber(
    process.env.MIGRATECK_DISK_CRITICAL_PERCENT,
    95,
  );
  const warningFreeBytes =
    finiteNumber(process.env.MIGRATECK_DISK_WARNING_FREE_GIB, 10) * GIB;
  const criticalFreeBytes =
    finiteNumber(process.env.MIGRATECK_DISK_CRITICAL_FREE_GIB, 5) * GIB;

  const classification = classifyDiskCapacity({
    usedPercent,
    availableBytes,
    warningPercent,
    criticalPercent,
    warningFreeBytes,
    criticalFreeBytes,
  });

  const totalMemory = totalmem();
  const freeMemory = freemem();
  const memoryUsed = Math.max(0, totalMemory - freeMemory);
  const memoryUsedPercent =
    totalMemory > 0
      ? Math.round((memoryUsed / totalMemory) * 1000) / 10
      : 0;

  const load = loadavg();
  const oneMinute = load[0] ?? 0;
  const fiveMinutes = load[1] ?? 0;
  const fifteenMinutes = load[2] ?? 0;

  return {
    state: classification.state,
    checkedPath,
    disk: {
      totalBytes,
      availableBytes,
      usedBytes,
      usedPercent,
      warningPercent,
      criticalPercent,
      warningFreeBytes,
      criticalFreeBytes,
    },
    memory: {
      totalBytes: totalMemory,
      freeBytes: freeMemory,
      usedBytes: memoryUsed,
      usedPercent: memoryUsedPercent,
    },
    loadAverage: {
      oneMinute,
      fiveMinutes,
      fifteenMinutes,
    },
    releases: await releaseInventory(),
    reasons: classification.reasons,
  };
}
