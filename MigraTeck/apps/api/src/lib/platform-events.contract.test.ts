import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { publishPlatformEvent } from "./platform-events.js";

test("platform event publication and webhook outbox derivation share one transaction client", async () => {
  const statements: Array<{ sql: string; params: unknown[] }> = [];

  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });

      if (sql.startsWith('SELECT id,events FROM "OrgWebhookEndpoint"')) {
        return {
          rows: [
            { id: "endpoint-created", events: ["api_key.created"] },
            { id: "endpoint-revoked", events: ["api_key.revoked"] },
            { id: "endpoint-all", events: [] },
          ],
        };
      }

      return { rows: [] };
    },
  } as unknown as PoolClient;

  const result = await publishPlatformEvent(client, {
    eventType: "api_key.created",
    source: "contract-test",
    orgId: "org-test",
    actorId: "user-test",
    entityType: "api_key",
    entityId: "key-test",
    payload: { name: "Automation key" },
  });

  assert.ok(result.eventId);
  assert.equal(result.webhookDeliveries, 2);

  const eventInserts = statements.filter((entry) =>
    entry.sql.startsWith('INSERT INTO "PlatformEvent"'),
  );
  const deliveryInserts = statements.filter((entry) =>
    entry.sql.startsWith('INSERT INTO "WebhookDelivery"'),
  );

  assert.equal(eventInserts.length, 1);
  assert.equal(deliveryInserts.length, 2);
  assert.equal(eventInserts[0]?.params[1], "api_key.created");
  assert.equal(eventInserts[0]?.params[3], "org-test");

  for (const delivery of deliveryInserts) {
    assert.equal(delivery.params[2], "api_key.created");
    assert.equal(delivery.params[4], 5);
    const payload = JSON.parse(String(delivery.params[3]));
    assert.equal(payload.event_id, result.eventId);
    assert.equal(payload.source, "contract-test");
    assert.equal(payload.entity_id, "key-test");
    assert.deepEqual(payload.data, { name: "Automation key" });
  }
});
