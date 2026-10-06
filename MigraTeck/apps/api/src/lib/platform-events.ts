import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export type PlatformEventInput = {
  eventType: string;
  source: string;
  orgId: string;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
};

const WEBHOOK_MAX_ATTEMPTS = 5;

/**
 * Persist one platform event and derive every subscribed webhook delivery in
 * the caller's existing database transaction.
 *
 * The caller owns COMMIT/ROLLBACK. This is intentionally not best-effort:
 * if the domain mutation commits, its event and webhook outbox rows commit
 * with it.
 */
export async function publishPlatformEvent(
  client: PoolClient,
  input: PlatformEventInput,
): Promise<{ eventId: string; webhookDeliveries: number }> {
  const eventId = randomUUID();
  const createdAt = new Date();

  await client.query(
    'INSERT INTO "PlatformEvent" (id,"eventType",source,"orgId","actorId","entityType","entityId",payload,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
    [
      eventId,
      input.eventType,
      input.source,
      input.orgId,
      input.actorId ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      JSON.stringify(input.payload ?? {}),
      createdAt,
    ],
  );

  const endpoints = await client.query<{ id: string; events: string[] }>(
    'SELECT id,events FROM "OrgWebhookEndpoint" WHERE "orgId"=$1 AND status=\'ACTIVE\'',
    [input.orgId],
  );

  let webhookDeliveries = 0;
  for (const endpoint of endpoints.rows) {
    if (endpoint.events.length > 0 && !endpoint.events.includes(input.eventType)) {
      continue;
    }

    await client.query(
      'INSERT INTO "WebhookDelivery" (id,"endpointId","eventType",payload,status,attempts,"maxAttempts","nextRetryAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4::jsonb,\'PENDING\',0,$5,NOW(),NOW(),NOW())',
      [
        randomUUID(),
        endpoint.id,
        input.eventType,
        JSON.stringify({
          event_id: eventId,
          source: input.source,
          actor_id: input.actorId ?? null,
          entity_type: input.entityType ?? null,
          entity_id: input.entityId ?? null,
          occurred_at: createdAt.toISOString(),
          data: input.payload ?? {},
        }),
        WEBHOOK_MAX_ATTEMPTS,
      ],
    );
    webhookDeliveries += 1;
  }

  return { eventId, webhookDeliveries };
}
