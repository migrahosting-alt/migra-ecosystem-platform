import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Typed Event Definitions ────────────────────────────────────────────

export type PlatformEventType =
  | "org.created"
  | "org.updated"
  | "org.deleted"
  | "user.registered"
  | "user.login"
  | "user.login_failed"
  | "membership.added"
  | "membership.removed"
  | "membership.role_changed"
  | "provisioning.job_queued"
  | "provisioning.job_started"
  | "provisioning.job_completed"
  | "provisioning.job_failed"
  | "provisioning.job_dead"
  | "entitlement.granted"
  | "entitlement.revoked"
  | "entitlement.expired"
  | "billing.checkout_completed"
  | "billing.subscription_created"
  | "billing.subscription_cancelled"
  | "billing.invoice_paid"
  | "billing.invoice_overdue"
  | "billing.payment_failed"
  | "security.mfa_enabled"
  | "security.mfa_disabled"
  | "security.password_changed"
  | "security.account_locked"
  | "security.suspicious_login"
  | "webhook.delivery_failed"
  | "webhook.endpoint_disabled"
  | "builder.site_published"
  | "builder.site_created"
  | "api_key.created"
  | "api_key.revoked"
  | "usage.quota_exceeded"
  | "system.maintenance_started"
  | "system.maintenance_ended"
  | "system.health_degraded"
  | "system.health_restored"
  | "ecosystem.suggestion_fired"
  | "ecosystem.suggestion_accepted"
  | "ecosystem.suggestion_dismissed"
  | "ecosystem.journey_stage_changed"
  | "ecosystem.bundle_purchased"
  | "partner.application_submitted"
  | "partner.approved"
  | "partner.referral_converted"
  // Phase F: Enterprise / Compliance
  | "secret.created"
  | "secret.rotated"
  | "secret.deleted"
  | "compliance.retention_executed"
  | "compliance.deletion_requested"
  | "compliance.deletion_completed"
  | "compliance.access_review_created"
  | "compliance.access_review_completed"
  | "backup.created"
  | "backup.completed"
  | "backup.verified"
  | "backup.failed"
  | "incident.created"
  | "incident.mitigated"
  | "incident.resolved"
  | "incident.closed";

export interface EmitEventInput {
  eventType: PlatformEventType | string;
  source: string;
  orgId?: string | undefined;
  actorId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  payload?: Prisma.InputJsonValue | undefined;
}

type EventHandler = (event: {
  eventType: string;
  source: string;
  orgId?: string | null;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload: Prisma.JsonValue | null;
}) => void | Promise<void>;

// ─── In-Process Event Bus ───────────────────────────────────────────────

const handlers = new Map<string, Set<EventHandler>>();

export function onPlatformEvent(
  eventPattern: string,
  handler: EventHandler
): () => void {
  if (!handlers.has(eventPattern)) {
    handlers.set(eventPattern, new Set());
  }
  handlers.get(eventPattern)!.add(handler);

  return () => {
    handlers.get(eventPattern)?.delete(handler);
  };
}

function matchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return eventType.startsWith(pattern.slice(0, -1));
  }
  return eventType === pattern;
}

// ─── Emit ───────────────────────────────────────────────────────────────

export async function emitPlatformEvent(input: EmitEventInput) {
  const data: Record<string, unknown> = {
    eventType: input.eventType,
    source: input.source,
  };
  if (input.orgId !== undefined) data.orgId = input.orgId;
  if (input.actorId !== undefined) data.actorId = input.actorId;
  if (input.entityType !== undefined) data.entityType = input.entityType;
  if (input.entityId !== undefined) data.entityId = input.entityId;
  if (input.payload !== undefined) data.payload = input.payload;

  const event = await prisma.platformEvent.create({ data: data as Parameters<typeof prisma.platformEvent.create>[0]["data"] });

  // Fire in-process handlers (non-blocking)
  for (const [pattern, handlerSet] of handlers.entries()) {
    if (matchesPattern(input.eventType, pattern)) {
      for (const handler of handlerSet) {
        try {
          const result = handler({
            eventType: event.eventType,
            source: event.source,
            orgId: event.orgId,
            actorId: event.actorId,
            entityType: event.entityType,
            entityId: event.entityId,
            payload: event.payload,
          });
          if (result instanceof Promise) {
            result.catch((err) =>
              console.error(`[platform-events] handler error for ${input.eventType}:`, err)
            );
          }
        } catch (err) {
          console.error(`[platform-events] handler error for ${input.eventType}:`, err);
        }
      }
    }
  }

  return event;
}

// ─── Query ──────────────────────────────────────────────────────────────

export interface QueryEventsInput {
  eventType?: string | undefined;
  source?: string | undefined;
  orgId?: string | undefined;
  actorId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export async function queryPlatformEvents(input: QueryEventsInput) {
  const limit = Math.min(input.limit ?? 50, 200);

  const where: Prisma.PlatformEventWhereInput = {
    ...(input.eventType ? { eventType: input.eventType } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.orgId ? { orgId: input.orgId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.since || input.until
      ? {
          createdAt: {
            ...(input.since ? { gte: input.since } : {}),
            ...(input.until ? { lte: input.until } : {}),
          },
        }
      : {}),
  };

  const events = await prisma.platformEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = events.length > limit;
  const items = hasMore ? events.slice(0, limit) : events;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id : null,
  };
}

// ─── Mark Processed ─────────────────────────────────────────────────────

export async function markEventsProcessed(eventIds: string[]) {
  return prisma.platformEvent.updateMany({
    where: { id: { in: eventIds } },
    data: { processedAt: new Date() },
  });
}

// ─── Unprocessed Events (for workers) ───────────────────────────────────

export async function getUnprocessedEvents(batchSize = 50) {
  return prisma.platformEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });
}
