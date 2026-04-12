import { ProvisioningJobStatus } from "@prisma/client";
import { hostname } from "node:os";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { appendProvisioningJobEvent } from "@/lib/provisioning/jobs";

function parseArgs(argv: string[]) {
  const orgSlugs: string[] = [];
  let reason = "missing_required_hosting_context";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;

    if (token === "--org-slug") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --org-slug");
      }
      orgSlugs.push(value);
      index += 1;
      continue;
    }

    if (token === "--reason") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --reason");
      }
      reason = value;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  if (orgSlugs.length === 0) {
    throw new Error("provide at least one --org-slug");
  }

  return { orgSlugs, reason };
}

function missingRequiredContext(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return true;
  }

  const record = payload as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : null;
  const tenantId = typeof record.tenantId === "string" ? record.tenantId.trim() : "";
  const serviceInstanceId = typeof record.serviceInstanceId === "string" ? record.serviceInstanceId.trim() : "";
  const domain = typeof record.domain === "string" ? record.domain.trim() : "";
  const targetIp = typeof record.targetIp === "string" ? record.targetIp.trim() : "";

  if (action === "POD_CREATE") {
    return !tenantId || !serviceInstanceId || !domain;
  }

  if (action === "DNS_PROVISION") {
    return !domain || !targetIp;
  }

  if (action === "STORAGE_PROVISION") {
    return !tenantId || !domain;
  }

  return false;
}

async function main() {
  const { orgSlugs, reason } = parseArgs(process.argv.slice(2));
  const operator = ["manual-dead-letter", hostname(), String(process.pid)].join(":");

  const jobs = await prisma.provisioningJob.findMany({
    where: {
      status: ProvisioningJobStatus.PENDING,
      org: {
        slug: {
          in: orgSlugs,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      orgId: true,
      payload: true,
      org: {
        select: {
          slug: true,
        },
      },
    },
  });

  const malformedJobs = jobs.filter((job) => missingRequiredContext(job.payload));

  for (const job of malformedJobs) {
    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        status: ProvisioningJobStatus.DEAD,
        lastError: reason,
        lastErrorAt: new Date(),
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });

    await appendProvisioningJobEvent({
      jobId: job.id,
      status: ProvisioningJobStatus.DEAD,
      message: reason,
      metadata: {
        operator,
        malformed: true,
      },
    });

    await writeAuditLog({
      orgId: job.orgId,
      action: "PROVISIONING_JOB_DEAD_LETTERED",
      resourceType: "provisioning_job",
      resourceId: job.id,
      riskTier: 2,
      metadata: {
        reason,
        operator,
        malformed: true,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        requestedOrgSlugs: orgSlugs,
        reason,
        matched: jobs.length,
        deadLettered: malformedJobs.length,
        jobs: malformedJobs.map((job) => ({
          id: job.id,
          orgSlug: job.org.slug,
          action:
            typeof job.payload === "object" && job.payload && "action" in job.payload
              ? (job.payload as { action?: unknown }).action
              : null,
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
