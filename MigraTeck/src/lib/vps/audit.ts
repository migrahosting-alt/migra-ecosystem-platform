import { Prisma, type VpsAuditSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

export async function writeVpsAuditEvent(input: {
  orgId: string;
  serverId: string;
  actorUserId?: string | null | undefined;
  eventType: string;
  severity?: VpsAuditSeverity | undefined;
  sourceIp?: string | null | undefined;
  relatedJobId?: string | null | undefined;
  metadataJson?: unknown | undefined;
}) {
  return prisma.vpsAuditEvent.create({
    data: {
      orgId: input.orgId,
      serverId: input.serverId,
      actorUserId: input.actorUserId || null,
      eventType: input.eventType,
      severity: input.severity || "INFO",
      sourceIp: input.sourceIp || null,
      relatedJobId: input.relatedJobId || null,
      payloadJson: input.metadataJson === undefined ? Prisma.JsonNull : jsonValue(input.metadataJson),
    },
  });
}
