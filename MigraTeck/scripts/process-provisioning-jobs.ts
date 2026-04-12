import { hostname } from "node:os";
import { prisma } from "@/lib/prisma";
import { processProvisioningJobIds } from "../workers/provisioning-engine";

function parseArgs(argv: string[]) {
  const jobIds: string[] = [];
  const orgSlugs: string[] = [];
  let limit: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;

    if (token === "--job-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --job-id");
      }
      jobIds.push(value);
      index += 1;
      continue;
    }

    if (token === "--org-slug") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --org-slug");
      }
      orgSlugs.push(value);
      index += 1;
      continue;
    }

    if (token === "--limit") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --limit");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("invalid value for --limit");
      }
      limit = parsed;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  if (jobIds.length === 0 && orgSlugs.length === 0) {
    throw new Error("provide at least one --job-id or --org-slug");
  }

  return { jobIds, orgSlugs, limit };
}

async function resolveJobIds(orgSlugs: string[], limit: number | null): Promise<string[]> {
  if (orgSlugs.length === 0) {
    return [];
  }

  const jobs = await prisma.provisioningJob.findMany({
    where: {
      status: "PENDING",
      org: {
        slug: {
          in: orgSlugs,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
    },
  });

  return jobs.map((job) => job.id);
}

async function main() {
  const { jobIds, orgSlugs, limit } = parseArgs(process.argv.slice(2));
  const resolvedFromSlugs = await resolveJobIds(orgSlugs, limit);
  const uniqueJobIds = [...new Set([...jobIds, ...resolvedFromSlugs])];

  const processed = await processProvisioningJobIds(
    uniqueJobIds,
    ["manual-targeted", hostname(), String(process.pid)].join(":"),
  );

  const results = await prisma.provisioningJob.findMany({
    where: {
      id: {
        in: uniqueJobIds,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      status: true,
      lastError: true,
      payload: true,
      org: {
        select: {
          slug: true,
        },
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        processed,
        requested: uniqueJobIds.length,
        results: results.map((job) => ({
          id: job.id,
          orgSlug: job.org.slug,
          status: job.status,
          lastError: job.lastError,
          action: typeof job.payload === "object" && job.payload && "action" in job.payload ? (job.payload as { action?: unknown }).action : null,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
