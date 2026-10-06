import { promises as fs } from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

type LegacyProjectSummary = {
  id: string;
  name: string;
  status: string;
  type: string | null;
  templateKey: string | null;
  templateLabel: string | null;
  tier: string | null;
  source: string | null;
  submissionsCount: number;
  leadScore: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  dueDate: string | null;
};

type LegacyFileSnapshot = {
  projects: LegacyProjectSummary[];
  counts: {
    projects: number;
    submissions: number;
    uploads: number;
    backups: number;
  };
  projectStatus: Record<string, number>;
  projectTier: Record<string, number>;
  storage: {
    uploadsBytes: number;
    intakePayloadBytes: number;
  };
  backups: {
    latestAt: string | null;
    latestName: string | null;
  };
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function listFiles(directory: string, predicate?: (name: string) => boolean) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && (!predicate || predicate(entry.name)));
  } catch {
    return [];
  }
}

async function sumFileBytes(directory: string, names: string[]): Promise<number> {
  let total = 0;
  for (const name of names) {
    try {
      const stat = await fs.stat(path.join(directory, name));
      total += stat.size;
    } catch {
      // A file may disappear between readdir/stat. Treat that as a transient skip.
    }
  }
  return total;
}

function increment(counter: Record<string, number>, key: string | null) {
  const normalized = key || "unknown";
  counter[normalized] = (counter[normalized] ?? 0) + 1;
}

export async function readLegacyIntakeFiles(
  rootPath: string,
): Promise<LegacyFileSnapshot> {
  const dataDir = path.join(rootPath, "data");
  const projectsRaw = await readJsonFile<unknown[]>(
    path.join(dataDir, "projects.json"),
    [],
  );

  const projects: LegacyProjectSummary[] = projectsRaw
    .filter((entry): entry is JsonObject => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      id: asString(entry.id) ?? "unknown",
      name: asString(entry.name) ?? "Untitled project",
      status: asString(entry.status) ?? "unknown",
      type: asString(entry.type),
      templateKey: asString(entry.templateKey),
      templateLabel: asString(entry.templateLabel),
      tier: asString(entry.tier),
      source: asString(entry.source),
      submissionsCount: Math.max(0, asNumber(entry.submissionsCount) ?? 0),
      leadScore: asNumber(entry.leadScore),
      createdAt: asString(entry.createdAt),
      updatedAt: asString(entry.updatedAt),
      lastActivity: asString(entry.lastActivity),
      dueDate: asString(entry.dueDate),
    }))
    .sort((a, b) => {
      const left = Date.parse(a.lastActivity ?? a.updatedAt ?? a.createdAt ?? "") || 0;
      const right = Date.parse(b.lastActivity ?? b.updatedAt ?? b.createdAt ?? "") || 0;
      return right - left;
    });

  const intakeDir = path.join(dataDir, "intakes");
  const uploadDir = path.join(rootPath, "uploads");
  const backupDir = path.join(rootPath, "backups");

  const [intakeFiles, uploadFiles, backupFiles] = await Promise.all([
    listFiles(intakeDir, (name) => name.endsWith(".json")),
    listFiles(uploadDir),
    listFiles(backupDir, (name) => name.endsWith(".tgz")),
  ]);

  const [intakePayloadBytes, uploadsBytes] = await Promise.all([
    sumFileBytes(intakeDir, intakeFiles.map((entry) => entry.name)),
    sumFileBytes(uploadDir, uploadFiles.map((entry) => entry.name)),
  ]);

  let latestBackup: { name: string; mtimeMs: number } | null = null;
  for (const entry of backupFiles) {
    try {
      const stat = await fs.stat(path.join(backupDir, entry.name));
      if (!latestBackup || stat.mtimeMs > latestBackup.mtimeMs) {
        latestBackup = { name: entry.name, mtimeMs: stat.mtimeMs };
      }
    } catch {
      // Ignore a backup that disappeared while the directory was being read.
    }
  }

  const projectStatus: Record<string, number> = {};
  const projectTier: Record<string, number> = {};
  for (const project of projects) {
    increment(projectStatus, project.status);
    increment(projectTier, project.tier);
  }

  return {
    projects,
    counts: {
      projects: projects.length,
      submissions: intakeFiles.length,
      uploads: uploadFiles.length,
      backups: backupFiles.length,
    },
    projectStatus,
    projectTier,
    storage: {
      uploadsBytes,
      intakePayloadBytes,
    },
    backups: {
      latestAt: latestBackup ? new Date(latestBackup.mtimeMs).toISOString() : null,
      latestName: latestBackup?.name ?? null,
    },
  };
}

async function fetchLegacyHealth(healthUrl: string) {
  try {
    const response = await fetch(healthUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      return {
        reachable: false,
        statusCode: response.status,
        status: "degraded",
        service: "MigraIntake",
        version: null,
        features: {},
        storage: {},
      };
    }

    const body = await response.json() as JsonObject;
    return {
      reachable: true,
      statusCode: response.status,
      status: asString(body.status) ?? "unknown",
      service: asString(body.service) ?? "MigraIntake",
      version: asString(body.version),
      features:
        body.features && typeof body.features === "object"
          ? body.features as JsonObject
          : {},
      storage:
        body.storage && typeof body.storage === "object"
          ? body.storage as JsonObject
          : {},
    };
  } catch (error) {
    return {
      reachable: false,
      statusCode: 0,
      status: "unreachable",
      service: "MigraIntake",
      version: null,
      features: {},
      storage: {},
      error: error instanceof Error ? error.message : "Health request failed",
    };
  }
}

export async function getIntakeRuntimeSnapshot() {
  const rootPath =
    process.env.MIGRAINTAKE_LEGACY_ROOT?.trim() || "/opt/migra-intake";
  const healthUrl =
    process.env.MIGRAINTAKE_LEGACY_HEALTH_URL?.trim() ||
    "http://127.0.0.1:4000/health";

  const [health, files] = await Promise.all([
    fetchLegacyHealth(healthUrl),
    readLegacyIntakeFiles(rootPath),
  ]);

  return {
    runtime: {
      mode: "legacy_global",
      tenantScoped: false,
      health,
      portalUrl:
        process.env.MIGRAINTAKE_PORTAL_URL?.trim() ||
        "https://intake.migrahosting.com",
      adminPortalUrl:
        process.env.MIGRAINTAKE_ADMIN_URL?.trim() ||
        "https://intake.migrahosting.com/admin-v3.html",
    },
    legacy: files,
    boundary: {
      attribution:
        "Projects and submissions belong to the global legacy MigraIntake runtime and are not assigned to the active customer organization.",
      writes:
        "Read-only from MigraTeck Platform. Operational changes stay in the legacy MigraIntake portal until the tenant-native service is production-ready.",
      migrationTarget: "@migrateck/intake-service",
      migrationTargetReady: false,
      migrationBlockers: [
        "tenant-native service has no production authentication boundary",
        "PlatformOperation persistence is not deployed in the production database",
        "dedicated Intake domain models are still pending",
      ],
    },
  };
}
