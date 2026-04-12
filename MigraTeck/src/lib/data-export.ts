import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────

export type ExportType = "users" | "audit" | "usage" | "billing" | "notifications" | "memberships";
export type ExportFormat = "csv" | "json";

export interface RequestExportInput {
  orgId: string;
  userId: string;
  exportType: ExportType;
  format?: ExportFormat | undefined;
  filters?: Prisma.InputJsonValue | undefined;
}

// ─── Request Export ─────────────────────────────────────────────────────

export async function requestDataExport(input: RequestExportInput) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

  const data: Record<string, unknown> = {
    orgId: input.orgId,
    userId: input.userId,
    exportType: input.exportType,
    format: input.format ?? "csv",
    expiresAt,
  };
  if (input.filters !== undefined) data.filters = input.filters;

  return prisma.dataExport.create({ data: data as Parameters<typeof prisma.dataExport.create>[0]["data"] });
}

// ─── Export Generators ──────────────────────────────────────────────────

function escapeCsvField(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

async function generateMembersExport(orgId: string, format: ExportFormat): Promise<{ content: string; rowCount: number }> {
  const memberships = await prisma.membership.findMany({
    where: { orgId },
    include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (format === "json") {
    const rows = memberships.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      status: m.status,
      joinedAt: m.createdAt.toISOString(),
    }));
    return { content: JSON.stringify(rows, null, 2), rowCount: rows.length };
  }

  const header = toCsvRow(["userId", "name", "email", "role", "status", "joinedAt"]);
  const rows = memberships.map((m) =>
    toCsvRow([m.user.id, m.user.name, m.user.email, m.role, m.status, m.createdAt.toISOString()])
  );
  return { content: [header, ...rows].join("\n"), rowCount: rows.length };
}

async function generateAuditExport(
  orgId: string,
  format: ExportFormat,
  filters?: Record<string, unknown>
): Promise<{ content: string; rowCount: number }> {
  const since = filters?.since ? new Date(String(filters.since)) : undefined;
  const until = filters?.until ? new Date(String(filters.until)) : undefined;

  const logs = await prisma.auditLog.findMany({
    where: {
      orgId,
      ...(since || until
        ? {
            createdAt: {
              ...(since ? { gte: since } : {}),
              ...(until ? { lte: until } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  if (format === "json") {
    return { content: JSON.stringify(logs, null, 2), rowCount: logs.length };
  }

  const header = toCsvRow(["id", "action", "entityType", "entityId", "ip", "createdAt"]);
  const rows = logs.map((l) =>
    toCsvRow([l.id, l.action, l.entityType, l.entityId, l.ip, l.createdAt.toISOString()])
  );
  return { content: [header, ...rows].join("\n"), rowCount: rows.length };
}

async function generateUsageExport(
  orgId: string,
  format: ExportFormat,
  filters?: Record<string, unknown>
): Promise<{ content: string; rowCount: number }> {
  const since = filters?.since ? new Date(String(filters.since)) : undefined;

  const events = await prisma.usageEvent.findMany({
    where: {
      orgId,
      ...(since ? { timestamp: { gte: since } } : {}),
    },
    orderBy: { timestamp: "desc" },
    take: 10000,
  });

  if (format === "json") {
    return { content: JSON.stringify(events, null, 2), rowCount: events.length };
  }

  const header = toCsvRow(["id", "product", "metric", "quantity", "timestamp"]);
  const rows = events.map((e) =>
    toCsvRow([e.id, e.product, e.metric, e.quantity, e.timestamp.toISOString()])
  );
  return { content: [header, ...rows].join("\n"), rowCount: rows.length };
}

async function generateBillingExport(
  orgId: string,
  format: ExportFormat
): Promise<{ content: string; rowCount: number }> {
  const subscriptions = await prisma.billingSubscription.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });

  if (format === "json") {
    return { content: JSON.stringify(subscriptions, null, 2), rowCount: subscriptions.length };
  }

  const header = toCsvRow(["id", "provider", "status", "currentPeriodStart", "currentPeriodEnd", "createdAt"]);
  const rows = subscriptions.map((s) =>
    toCsvRow([s.id, s.provider, s.status, s.currentPeriodStart?.toISOString(), s.currentPeriodEnd?.toISOString(), s.createdAt.toISOString()])
  );
  return { content: [header, ...rows].join("\n"), rowCount: rows.length };
}

async function generateNotificationsExport(
  orgId: string,
  format: ExportFormat
): Promise<{ content: string; rowCount: number }> {
  const notifications = await prisma.notification.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  if (format === "json") {
    return { content: JSON.stringify(notifications, null, 2), rowCount: notifications.length };
  }

  const header = toCsvRow(["id", "title", "category", "channel", "status", "createdAt"]);
  const rows = notifications.map((n) =>
    toCsvRow([n.id, n.title, n.category, n.channel, n.status, n.createdAt.toISOString()])
  );
  return { content: [header, ...rows].join("\n"), rowCount: rows.length };
}

// ─── Export Processor ───────────────────────────────────────────────────

const generators: Record<
  string,
  (orgId: string, format: ExportFormat, filters?: Record<string, unknown>) => Promise<{ content: string; rowCount: number }>
> = {
  memberships: generateMembersExport,
  users: generateMembersExport,
  audit: generateAuditExport,
  usage: generateUsageExport,
  billing: generateBillingExport,
  notifications: generateNotificationsExport,
};

export async function processExport(exportId: string): Promise<void> {
  const exp = await prisma.dataExport.findUniqueOrThrow({ where: { id: exportId } });

  await prisma.dataExport.update({
    where: { id: exportId },
    data: { status: "PROCESSING" },
  });

  try {
    const generator = generators[exp.exportType];
    if (!generator) throw new Error(`Unknown export type: ${exp.exportType}`);

    const filters = exp.filters as Record<string, unknown> | null;
    const { content, rowCount } = await generator(
      exp.orgId,
      exp.format as ExportFormat,
      filters ?? undefined
    );

    const ext = exp.format === "json" ? "json" : "csv";
    const fileName = `${exp.exportType}-${exp.orgId}-${Date.now()}.${ext}`;

    await prisma.dataExport.update({
      where: { id: exportId },
      data: {
        status: "COMPLETED",
        fileName,
        fileSize: Buffer.byteLength(content, "utf-8"),
        rowCount,
        // Store content inline as fileKey (for small exports)
        // For production, this would be an S3 key
        fileKey: `exports/${fileName}`,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.dataExport.update({
      where: { id: exportId },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

// ─── Query Exports ──────────────────────────────────────────────────────

export async function listExports(orgId: string, userId?: string) {
  return prisma.dataExport.findMany({
    where: {
      orgId,
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getExport(exportId: string, orgId: string) {
  return prisma.dataExport.findFirst({
    where: { id: exportId, orgId },
  });
}

// ─── Cleanup ────────────────────────────────────────────────────────────

export async function cleanupExpiredExports() {
  const result = await prisma.dataExport.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
