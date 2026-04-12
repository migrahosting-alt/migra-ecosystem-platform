import { createPublicKey, verify as verifySignature } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env, migraMarketSmsBatchSize, telnyxMessagingWebhookToleranceSeconds } from "@/lib/env";
import { normalizeUsPhoneNumber } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { normalizeStringList } from "@/lib/migramarket";

export { normalizeUsPhoneNumber } from "@/lib/phone";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";
const DEFAULT_COMPLIANCE_SUFFIX = "Reply STOP to opt out, HELP for help.";
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

type JsonRecord = Record<string, unknown>;

export function normalizeMessagingTags(value: unknown): string[] {
  return normalizeStringList(value).map((item) => item.toLowerCase());
}

export function tagsToJson(tags: string[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(tags.map((item) => item.toLowerCase()))) as Prisma.InputJsonValue;
}

export function withComplianceSuffix(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("Message body is required.");
  }

  if (/reply\s+stop/i.test(trimmed) && /help/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}\n\n${DEFAULT_COMPLIANCE_SUFFIX}`;
}

function supportsMarketingConsent(lead: {
  smsConsentStatus: string;
  smsOptedOutAt: Date | null;
  phone: string | null;
  messagingTags: Prisma.JsonValue | null;
}, audienceTag?: string | null) {
  if (!lead.phone || lead.smsConsentStatus !== "subscribed" || lead.smsOptedOutAt) {
    return false;
  }

  if (!audienceTag) {
    return true;
  }

  return normalizeMessagingTags(lead.messagingTags).includes(audienceTag.toLowerCase());
}

function extractMessageId(payload: unknown): string | null {
  const event = payload && typeof payload === "object" ? (payload as JsonRecord) : null;
  const data = event?.data && typeof event.data === "object" ? (event.data as JsonRecord) : null;
  const inner = data?.payload && typeof data.payload === "object" ? (data.payload as JsonRecord) : null;
  const candidate = inner?.id ?? data?.id ?? inner?.message_id ?? data?.message_id;
  return typeof candidate === "string" && candidate ? candidate : null;
}

function extractPhoneNumber(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractPhoneNumber(item);
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as JsonRecord;
  const candidate = record.phone_number ?? record.phoneNumber ?? record.number ?? record.address;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function normalizePhoneNumberOrNull(value: unknown): string | null {
  const candidate = extractPhoneNumber(value);
  if (!candidate) {
    return null;
  }

  try {
    return normalizeUsPhoneNumber(candidate);
  } catch {
    return null;
  }
}

function extractMessageText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as JsonRecord;
  const candidate = record.text ?? record.body;
  return typeof candidate === "string" ? candidate.trim() : "";
}

function extractEventTimestamp(value: unknown): Date | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as JsonRecord;
  const candidate = record.occurred_at ?? record.received_at ?? record.sent_at;
  if (typeof candidate !== "string" || !candidate.trim()) {
    return null;
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveTelnyxWebhookPublicKey(publicKey: string) {
  const trimmed = publicKey.trim();
  if (!trimmed) {
    throw new Error("Webhook public key is empty.");
  }

  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(trimmed);
  }

  const decoded = Buffer.from(trimmed, "base64");
  if (!decoded.length) {
    throw new Error("Webhook public key is not valid base64.");
  }

  if (decoded.length === 32) {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, decoded]),
      format: "der",
      type: "spki",
    });
  }

  return createPublicKey({
    key: decoded,
    format: "der",
    type: "spki",
  });
}

export function verifyTelnyxWebhookSignature(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  if (!env.TELNYX_MESSAGING_WEBHOOK_PUBLIC_KEY) {
    return true;
  }

  if (!timestamp || !signature) {
    return false;
  }

  const receivedAt = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(receivedAt)) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - receivedAt);
  if (ageSeconds > telnyxMessagingWebhookToleranceSeconds) {
    return false;
  }

  try {
    const publicKey = resolveTelnyxWebhookPublicKey(env.TELNYX_MESSAGING_WEBHOOK_PUBLIC_KEY);
    return verifySignature(
      null,
      Buffer.from(`${timestamp}|${rawBody}`),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

async function sendTelnyxMessage(input: {
  from: string;
  to: string;
  text: string;
  mediaUrls: string[];
}) {
  if (!env.TELNYX_API_KEY) {
    throw new Error("TELNYX_API_KEY is not configured.");
  }

  const response = await fetch(`${TELNYX_API_BASE}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      text: input.text,
      ...(env.TELNYX_MESSAGING_PROFILE_ID ? { messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID } : {}),
      ...(input.mediaUrls.length > 0 ? { media_urls: input.mediaUrls } : {}),
    }),
  });

  const payload = (await response.json().catch(() => null)) as JsonRecord | null;
  if (!response.ok) {
    const detail = typeof payload?.errors === "object" ? JSON.stringify(payload.errors) : response.statusText;
    throw new Error(`Telnyx send failed: ${detail}`);
  }

  const data = payload?.data && typeof payload.data === "object" ? (payload.data as JsonRecord) : null;
  const id = typeof data?.id === "string" ? data.id : null;

  if (!id) {
    throw new Error("Telnyx send failed: missing message id.");
  }

  return { id, payload };
}

async function syncCampaignStats(campaignId: string) {
  const [recipientCount, queuedCount, sentCount, deliveredCount, failedCount] = await Promise.all([
    prisma.migraMarketMessagingDelivery.count({ where: { campaignId, direction: "outbound" } }),
    prisma.migraMarketMessagingDelivery.count({ where: { campaignId, direction: "outbound", status: "queued" } }),
    prisma.migraMarketMessagingDelivery.count({ where: { campaignId, direction: "outbound", status: { in: ["submitted", "sent", "delivered", "finalized"] } } }),
    prisma.migraMarketMessagingDelivery.count({ where: { campaignId, direction: "outbound", status: { in: ["delivered", "finalized"] } } }),
    prisma.migraMarketMessagingDelivery.count({ where: { campaignId, direction: "outbound", status: { in: ["failed", "undelivered", "rejected"] } } }),
  ]);

  return prisma.migraMarketMessagingCampaign.update({
    where: { id: campaignId },
    data: {
      recipientCount,
      queuedCount,
      sentCount,
      deliveredCount,
      failedCount,
      ...(queuedCount === 0 && recipientCount > 0 ? { status: "sent", completedAt: new Date() } : {}),
    },
  });
}

async function buildQueuedDeliveries(campaignId: string) {
  const campaign = await prisma.migraMarketMessagingCampaign.findUnique({
    where: { id: campaignId },
    include: { org: true },
  });

  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  const eligibleLeads = await prisma.migraMarketLeadRecord.findMany({
    where: {
      orgId: campaign.orgId,
      phone: { not: null },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const existingOutboundPhones = new Set(
    (
      await prisma.migraMarketMessagingDelivery.findMany({
        where: {
          campaignId,
          direction: "outbound",
        },
        select: {
          phone: true,
        },
      })
    ).map((delivery) => delivery.phone),
  );

  const recipients = eligibleLeads
    .filter((lead) => supportsMarketingConsent(lead, campaign.audienceTag))
    .flatMap((lead) => {
      try {
        const phone = normalizeUsPhoneNumber(lead.phone || "");
        if (existingOutboundPhones.has(phone)) {
          return [];
        }

        return [{
          orgId: campaign.orgId,
          campaignId: campaign.id,
          leadId: lead.id,
          phone,
          metadata: {
            leadId: lead.id,
            sourceChannel: lead.sourceChannel,
          } as Prisma.InputJsonValue,
        }];
      } catch {
        return [];
      }
    });

  if (recipients.length > 0) {
    await prisma.migraMarketMessagingDelivery.createMany({
      data: recipients,
    });
  }

  return recipients.length;
}

export async function dispatchMessagingCampaign(campaignId: string, batchSize = migraMarketSmsBatchSize) {
  const campaign = await prisma.migraMarketMessagingCampaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  const createdCount = await buildQueuedDeliveries(campaignId);
  const queuedDeliveries = await prisma.migraMarketMessagingDelivery.findMany({
    where: {
      campaignId,
      direction: "outbound",
      status: "queued",
    },
    include: {
      lead: true,
    },
    orderBy: [{ createdAt: "asc" }],
    take: Math.max(1, batchSize),
  });

  if (queuedDeliveries.length === 0) {
    const refreshed = await syncCampaignStats(campaignId);
    return {
      campaign: refreshed,
      createdCount,
      processedCount: 0,
      queuedRemaining: refreshed.queuedCount,
    };
  }

  const messageText = withComplianceSuffix(campaign.body);
  const mediaUrls = normalizeStringList(campaign.mediaUrls);
  const launchedAt = campaign.launchedAt || new Date();

  await prisma.migraMarketMessagingCampaign.update({
    where: { id: campaignId },
    data: {
      status: "sending",
      launchedAt,
      lastDispatchedAt: new Date(),
    },
  });

  let processedCount = 0;
  for (const delivery of queuedDeliveries) {
    try {
      const result = await sendTelnyxMessage({
        from: normalizeUsPhoneNumber(campaign.fromNumber),
        to: normalizeUsPhoneNumber(delivery.phone),
        text: messageText,
        mediaUrls,
      });

      await prisma.migraMarketMessagingDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "submitted",
          externalMessageId: result.id,
          metadata: {
            ...(typeof delivery.metadata === "object" && delivery.metadata && !Array.isArray(delivery.metadata)
              ? (delivery.metadata as JsonRecord)
              : {}),
            telnyx: result.payload,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      await prisma.migraMarketMessagingDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown send failure.",
        },
      });
    }

    processedCount += 1;
  }

  const refreshed = await syncCampaignStats(campaignId);
  return {
    campaign: refreshed,
    createdCount,
    processedCount,
    queuedRemaining: refreshed.queuedCount,
  };
}

export async function applyInboundOptOut(phone: string, evidence: string) {
  const normalized = normalizeUsPhoneNumber(phone);
  await prisma.migraMarketLeadRecord.updateMany({
    where: {
      phone: normalized,
    },
    data: {
      smsConsentStatus: "unsubscribed",
      smsOptedOutAt: new Date(),
      smsConsentEvidence: evidence,
    },
  });
}

export async function recordTelnyxWebhookEvent(_rawBody: string, payload: unknown) {
  const event = payload && typeof payload === "object" ? (payload as JsonRecord) : {};
  const data = event.data && typeof event.data === "object" ? (event.data as JsonRecord) : {};
  const eventId = typeof data.id === "string" ? data.id : null;
  const eventType = typeof data.event_type === "string" ? data.event_type : typeof event.event_type === "string" ? event.event_type : "unknown";

  if (!eventId) {
    throw new Error("Webhook event id missing.");
  }

  const stored = await prisma.migraMarketMessagingWebhookEvent.upsert({
    where: { externalEventId: eventId },
    update: {
      payload: payload as Prisma.InputJsonValue,
    },
    create: {
      externalEventId: eventId,
      eventType,
      payload: payload as Prisma.InputJsonValue,
    },
  });

  return { stored, eventType };
}

async function markWebhookProcessed(eventId: string | null, orgId?: string | null) {
  if (!eventId) {
    return;
  }

  await prisma.migraMarketMessagingWebhookEvent.update({
    where: { externalEventId: eventId },
    data: {
      ...(orgId ? { orgId } : {}),
      status: "processed",
      processedAt: new Date(),
    },
  });
}

async function resolveInboundDeliveryContext(input: { from: string; to: string | null }) {
  const matchedOutbound = await prisma.migraMarketMessagingDelivery.findFirst({
    where: {
      direction: "outbound",
      phone: input.from,
      ...(input.to
        ? {
            campaign: {
              fromNumber: input.to,
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
  });

  if (matchedOutbound) {
    return {
      orgId: matchedOutbound.orgId,
      campaignId: matchedOutbound.campaignId,
      leadId: matchedOutbound.leadId,
    };
  }

  const matchedLead = await prisma.migraMarketLeadRecord.findFirst({
    where: {
      phone: input.from,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const matchedCampaign = await prisma.migraMarketMessagingCampaign.findFirst({
    where: {
      ...(matchedLead ? { orgId: matchedLead.orgId } : {}),
      ...(input.to ? { fromNumber: input.to } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
  });

  if (matchedLead) {
    return {
      orgId: matchedLead.orgId,
      campaignId: matchedCampaign?.id ?? null,
      leadId: matchedLead.id,
    };
  }

  if (matchedCampaign) {
    return {
      orgId: matchedCampaign.orgId,
      campaignId: matchedCampaign.id,
      leadId: null,
    };
  }

  return null;
}

export async function processTelnyxWebhookPayload(payload: unknown) {
  const event = payload && typeof payload === "object" ? (payload as JsonRecord) : {};
  const data = event.data && typeof event.data === "object" ? (event.data as JsonRecord) : {};
  const eventId = typeof data.id === "string" ? data.id : null;
  const eventType = typeof data.event_type === "string" ? data.event_type : typeof event.event_type === "string" ? event.event_type : "unknown";
  const inner = data.payload && typeof data.payload === "object" ? (data.payload as JsonRecord) : {};
  const messageId = extractMessageId(payload);
  const from = normalizePhoneNumberOrNull(inner.from ?? inner.phone_number);
  const to = normalizePhoneNumberOrNull(inner.to);
  const text = extractMessageText(inner);
  const eventTimestamp = extractEventTimestamp(data) ?? extractEventTimestamp(inner) ?? new Date();

  if (messageId) {
    const delivery = await prisma.migraMarketMessagingDelivery.findUnique({
      where: { externalMessageId: messageId },
      include: { campaign: true },
    });

    if (delivery) {
      let status = delivery.status;
      if (delivery.direction === "outbound" && /delivered/i.test(eventType)) {
        status = "delivered";
      } else if (delivery.direction === "outbound" && (/finalized/i.test(eventType) || /sent/i.test(eventType))) {
        status = "finalized";
      } else if (delivery.direction === "outbound" && /undelivered|failed|rejected/i.test(eventType)) {
        status = "failed";
      } else if (delivery.direction === "inbound" && /message\.received/i.test(eventType)) {
        status = "received";
      }

      await prisma.migraMarketMessagingDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          body: delivery.direction === "inbound" && text ? text : delivery.body,
          deliveredAt: status === "delivered" ? new Date() : delivery.deliveredAt,
          finalizedAt: /finalized/i.test(eventType) ? new Date() : delivery.finalizedAt,
          metadata: payload as Prisma.InputJsonValue,
        },
      });

      await markWebhookProcessed(eventId, delivery.orgId);

      if (delivery.direction === "outbound" && delivery.campaignId) {
        await syncCampaignStats(delivery.campaignId);
      }
      return;
    }
  }

  let resolvedOrgId: string | null = null;

  if (/message\.received/i.test(eventType) && from) {
    const context = await resolveInboundDeliveryContext({ from, to });
    resolvedOrgId = context?.orgId ?? null;

    if (context) {
      await prisma.migraMarketMessagingDelivery.create({
        data: {
          orgId: context.orgId,
          campaignId: context.campaignId,
          leadId: context.leadId,
          phone: from,
          provider: "telnyx",
          direction: "inbound",
          status: "received",
          externalMessageId: messageId,
          body: text || null,
          deliveredAt: eventTimestamp,
          metadata: {
            payload,
            from,
            to,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  if (/message\.received/i.test(eventType) && from && STOP_KEYWORDS.has(text.toUpperCase())) {
    await applyInboundOptOut(from, `Inbound opt-out via Telnyx webhook: ${text}`);
  }

  await markWebhookProcessed(eventId, resolvedOrgId);
}
