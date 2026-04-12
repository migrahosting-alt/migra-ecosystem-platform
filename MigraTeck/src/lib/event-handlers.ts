/**
 * Platform Event Handlers Bootstrap
 *
 * Registers in-process event handlers that connect the event bus
 * to the alert engine, notification system, and other operational systems.
 *
 * Import this module once at app startup (e.g., in instrumentation.ts or layout.tsx server init).
 */
import { onPlatformEvent } from "@/lib/platform-events";
import { evaluateAlertRules } from "@/lib/alerts";
import { notifyOrgMembers } from "@/lib/notifications";
import { evaluateTrigger } from "@/lib/suggestions";
import { recalculateJourney, recordMilestone } from "@/lib/customer-journey";
import { Prisma } from "@prisma/client";

let initialized = false;

export function initEventHandlers() {
  if (initialized) return;
  initialized = true;

  // ─── Alert Engine: evaluate all events against rules ────────────────
  onPlatformEvent("*", async (event) => {
    try {
      await evaluateAlertRules(
        event.eventType,
        event.payload,
        event.orgId ?? undefined
      );
    } catch (err) {
      console.error("[event-handlers] alert evaluation failed:", err);
    }
  });

  // ─── Provisioning failures → org notification ──────────────────────
  onPlatformEvent("provisioning.job_failed", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Provisioning Failed",
      body: `A provisioning job failed. Check the operations dashboard for details.`,
      category: "provisioning",
      minRole: "ADMIN",
      metadata: {
        entityType: event.entityType,
        entityId: event.entityId,
      } as unknown as Prisma.InputJsonValue,
    }).catch(() => {});
  });

  // ─── Dead letter jobs → critical notification ──────────────────────
  onPlatformEvent("provisioning.job_dead", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Provisioning Job Dead",
      body: `A provisioning job exhausted all retries and is now dead. Manual intervention required.`,
      category: "provisioning",
      minRole: "ADMIN",
      metadata: {
        entityType: event.entityType,
        entityId: event.entityId,
      } as unknown as Prisma.InputJsonValue,
    }).catch(() => {});
  });

  // ─── Billing failures → billing + admin notification ───────────────
  onPlatformEvent("billing.payment_failed", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Payment Failed",
      body: "A payment attempt has failed. Please update your payment method.",
      category: "billing",
      actionUrl: "/app/billing",
      minRole: "BILLING",
    }).catch(() => {});
  });

  onPlatformEvent("billing.invoice_overdue", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Invoice Overdue",
      body: "You have an overdue invoice. Please make payment to avoid service interruption.",
      category: "billing",
      actionUrl: "/app/billing",
      minRole: "BILLING",
    }).catch(() => {});
  });

  // ─── Security events → security notification ──────────────────────
  onPlatformEvent("security.account_locked", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Account Locked",
      body: "An account in your organization has been locked due to repeated failed login attempts.",
      category: "security",
      minRole: "ADMIN",
    }).catch(() => {});
  });

  onPlatformEvent("security.suspicious_login", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Suspicious Login Detected",
      body: "A login from an unusual location or device was detected.",
      category: "security",
      minRole: "ADMIN",
    }).catch(() => {});
  });

  // ─── Webhook endpoint disabled → admin notification ────────────────
  onPlatformEvent("webhook.endpoint_disabled", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Webhook Endpoint Disabled",
      body: "A webhook endpoint was disabled due to repeated delivery failures.",
      category: "system",
      actionUrl: "/app/settings/webhooks",
      minRole: "ADMIN",
    }).catch(() => {});
  });

  // ─── Usage quota exceeded → billing notification ───────────────────
  onPlatformEvent("usage.quota_exceeded", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Usage Quota Exceeded",
      body: "Your organization has exceeded a usage quota. Upgrade your plan to restore full access.",
      category: "billing",
      actionUrl: "/app/billing",
      minRole: "BILLING",
    }).catch(() => {});
  });

  // ─── System health events → critical notification ─────────────────
  onPlatformEvent("system.health_degraded", async (event) => {
    if (!event.orgId) return;
    await notifyOrgMembers({
      orgId: event.orgId,
      title: "Service Health Degraded",
      body: "One or more platform services are experiencing degraded performance.",
      category: "system",
      actionUrl: "/app/platform/ops",
      minRole: "ADMIN",
    }).catch(() => {});
  });

  console.log("[event-handlers] Platform event handlers registered");

  // ─── Phase E: Ecosystem Suggestion Triggers ────────────────────────

  // Domain verified → suggest email
  onPlatformEvent("entitlement.granted", async (event) => {
    if (!event.orgId) return;
    const ctx: { userId?: string; eventType?: string } = { eventType: event.eventType };
    if (event.actorId) ctx.userId = event.actorId;
    await evaluateTrigger("DOMAIN_VERIFIED", event.orgId, ctx).catch(() => {});
  });

  // Site published → suggest backup, voice, lead capture
  onPlatformEvent("builder.site_published", async (event) => {
    if (!event.orgId) return;
    const triggers = ["SITE_PUBLISHED", "NO_BACKUP", "NO_VOICE"] as const;
    for (const trigger of triggers) {
      const ctx: { userId?: string; eventType?: string } = { eventType: event.eventType };
      if (event.actorId) ctx.userId = event.actorId;
      await evaluateTrigger(trigger, event.orgId, ctx).catch(() => {});
    }
  });

  // Billing overdue → cross-sell risk suggestion
  onPlatformEvent("billing.invoice_overdue", async (event) => {
    if (!event.orgId) return;
    const ctx: { userId?: string; eventType?: string } = { eventType: event.eventType };
    if (event.actorId) ctx.userId = event.actorId;
    await evaluateTrigger("BILLING_OVERDUE", event.orgId, ctx).catch(() => {});
  });

  // Usage milestone → product expansion suggestion
  onPlatformEvent("usage.quota_exceeded", async (event) => {
    if (!event.orgId) return;
    const ctx: { userId?: string; eventType?: string } = { eventType: event.eventType };
    if (event.actorId) ctx.userId = event.actorId;
    await evaluateTrigger("USAGE_MILESTONE", event.orgId, ctx).catch(() => {});
  });

  // ─── Phase E: Customer Journey Recalculation ──────────────────────

  // Recalculate journey on key lifecycle events
  const journeyTriggerEvents = [
    "entitlement.granted",
    "entitlement.revoked",
    "billing.subscription_created",
    "billing.subscription_cancelled",
    "billing.checkout_completed",
    "org.created",
  ];

  for (const eventType of journeyTriggerEvents) {
    onPlatformEvent(eventType, async (event) => {
      if (!event.orgId) return;
      await recalculateJourney(event.orgId).catch(() => {});
    });
  }

  // Record milestones
  onPlatformEvent("billing.checkout_completed", async (event) => {
    if (!event.orgId) return;
    await recordMilestone(event.orgId, "first_payment").catch(() => {});
  });

  onPlatformEvent("builder.site_published", async (event) => {
    if (!event.orgId) return;
    await recordMilestone(event.orgId, "first_site_published").catch(() => {});
  });

  onPlatformEvent("entitlement.granted", async (event) => {
    if (!event.orgId) return;
    await recordMilestone(event.orgId, "first_entitlement").catch(() => {});
  });

  console.log("[event-handlers] Ecosystem integration handlers registered");
}
