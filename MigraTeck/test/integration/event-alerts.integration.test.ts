import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createAlertRule } from "../../src/lib/alerts";
import { initEventHandlers } from "../../src/lib/event-handlers";
import { emitPlatformEvent, markEventsProcessed, queryPlatformEvents } from "../../src/lib/platform-events";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

describe("Platform events and alerting", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("persists emitted events and triggers matching alert rules", async () => {
    initEventHandlers();

    const actor = await createUser({
      email: "events-proof@example.com",
      password: "ProofPass123!",
      emailVerified: true,
    });
    const org = await createOrganization({
      name: "Events Proof Org",
      slug: "events-proof-org",
      createdById: actor.id,
    });
    await createMembership({ userId: actor.id, orgId: org.id, role: OrgRole.OWNER });

    const rule = await createAlertRule({
      name: "Suspicious login escalation",
      eventType: "security.suspicious_login",
      condition: {
        field: "riskScore",
        op: "gte",
        value: 80,
      },
      severity: "CRITICAL",
      cooldownMinutes: 1,
      notifyChannels: ["in_app"],
      notifyRoleMin: "ADMIN",
    });

    const event = await emitPlatformEvent({
      eventType: "security.suspicious_login",
      source: "integration-test",
      orgId: org.id,
      actorId: actor.id,
      entityType: "User",
      entityId: actor.id,
      payload: {
        riskScore: 95,
        reason: "new_location",
      },
    });

    const queried = await queryPlatformEvents({
      orgId: org.id,
      eventType: "security.suspicious_login",
    });
    expect(queried.items[0]?.id).toBe(event.id);

    await expect.poll(async () => prisma.alert.count({
      where: {
        orgId: org.id,
        ruleId: rule.id,
      },
    })).toBe(1);

    const alert = await prisma.alert.findFirstOrThrow({
      where: {
        orgId: org.id,
        ruleId: rule.id,
      },
    });
    expect(alert.severity).toBe("CRITICAL");
    expect(alert.source).toBe("alert-engine");

    await markEventsProcessed([event.id]);
    const processed = await prisma.platformEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(processed.processedAt).not.toBeNull();
  });
});