import { createHmac, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ── Signing ──

export function signWebhookPayload(secret: string, payload: string, timestamp: number): string {
  const data = `${timestamp}.${payload}`;
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

// ── Endpoint management ──

interface CreateEndpointInput {
  orgId: string;
  url: string;
  events: string[];
  description?: string | undefined;
}

export async function createWebhookEndpoint(input: CreateEndpointInput) {
  const secret = generateWebhookSecret();

  return prisma.orgWebhookEndpoint.create({
    data: {
      orgId: input.orgId,
      url: input.url,
      secret,
      events: input.events,
      ...(input.description ? { description: input.description } : {}),
    },
  });
}

export async function listWebhookEndpoints(orgId: string) {
  return prisma.orgWebhookEndpoint.findMany({
    where: { orgId },
    select: {
      id: true,
      url: true,
      events: true,
      status: true,
      description: true,
      failCount: true,
      lastDeliveryAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteWebhookEndpoint(orgId: string, endpointId: string) {
  return prisma.orgWebhookEndpoint.deleteMany({
    where: { id: endpointId, orgId },
  });
}

export async function updateWebhookEndpoint(
  orgId: string,
  endpointId: string,
  data: { url?: string | undefined; events?: string[] | undefined; description?: string | undefined; status?: "ACTIVE" | "PAUSED" | undefined },
) {
  // Strip undefined keys to satisfy exactOptionalPropertyTypes
  const cleanData: Record<string, unknown> = {};
  if (data.url !== undefined) cleanData.url = data.url;
  if (data.events !== undefined) cleanData.events = data.events;
  if (data.description !== undefined) cleanData.description = data.description;
  if (data.status !== undefined) cleanData.status = data.status;

  return prisma.orgWebhookEndpoint.updateMany({
    where: { id: endpointId, orgId },
    data: cleanData,
  });
}

// ── Event dispatch ──

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [0, 60_000, 300_000, 1_800_000, 7_200_000]; // immediate, 1m, 5m, 30m, 2h

interface DispatchEventInput {
  orgId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export async function dispatchWebhookEvent(input: DispatchEventInput): Promise<number> {
  const endpoints = await prisma.orgWebhookEndpoint.findMany({
    where: {
      orgId: input.orgId,
      status: "ACTIVE",
    },
  });

  let dispatched = 0;

  for (const endpoint of endpoints) {
    // Check if endpoint subscribes to this event type
    if (endpoint.events.length > 0 && !endpoint.events.includes(input.eventType)) {
      continue;
    }

    await prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventType: input.eventType,
        payload: input.payload as unknown as Prisma.InputJsonValue,
        status: "PENDING",
        maxAttempts: MAX_RETRY_ATTEMPTS,
        nextRetryAt: new Date(),
      },
    });

    dispatched++;
  }

  return dispatched;
}

// ── Delivery processor (call from a cron/worker) ──

export async function processPendingDeliveries(batchSize = 20): Promise<number> {
  const now = new Date();

  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      status: "PENDING",
      nextRetryAt: { lte: now },
    },
    include: {
      endpoint: { select: { url: true, secret: true, status: true } },
    },
    take: batchSize,
    orderBy: { nextRetryAt: "asc" },
  });

  let processed = 0;

  for (const delivery of deliveries) {
    // Skip if max attempts reached
    if (delivery.attempts >= delivery.maxAttempts) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED" },
      });
      continue;
    }

    if (delivery.endpoint.status !== "ACTIVE") {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "EXPIRED" },
      });
      continue;
    }

    const payloadStr = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(delivery.endpoint.secret, payloadStr, timestamp);
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(delivery.endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Timestamp": String(timestamp),
          "X-Webhook-Event": delivery.eventType,
        },
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      const responseBody = await response.text().catch(() => "");

      if (response.ok) {
        await prisma.$transaction([
          prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "DELIVERED",
              attempts: delivery.attempts + 1,
              lastAttemptAt: now,
              httpStatus: response.status,
              responseBody: responseBody.slice(0, 1000),
              duration,
            },
          }),
          prisma.orgWebhookEndpoint.update({
            where: { id: delivery.endpointId },
            data: { failCount: 0, lastDeliveryAt: now },
          }),
        ]);
      } else {
        await handleFailedAttempt(delivery.id, delivery.endpointId, delivery.attempts, {
          httpStatus: response.status,
          responseBody: responseBody.slice(0, 1000),
          duration,
        });
      }
    } catch {
      const duration = Date.now() - startTime;
      await handleFailedAttempt(delivery.id, delivery.endpointId, delivery.attempts, {
        httpStatus: 0,
        responseBody: "Connection error or timeout",
        duration,
      });
    }

    processed++;
  }

  return processed;
}

async function handleFailedAttempt(
  deliveryId: string,
  endpointId: string,
  currentAttempts: number,
  result: { httpStatus: number; responseBody: string; duration: number },
) {
  const nextAttempt = currentAttempts + 1;
  const isFinal = nextAttempt >= MAX_RETRY_ATTEMPTS;

  const retryDelay = RETRY_DELAYS_MS[nextAttempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
  const nextRetryAt = isFinal ? null : new Date(Date.now() + retryDelay);

  await prisma.$transaction([
    prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: nextAttempt,
        lastAttemptAt: new Date(),
        httpStatus: result.httpStatus,
        responseBody: result.responseBody,
        duration: result.duration,
        ...(isFinal ? { status: "FAILED" as const } : {}),
        ...(nextRetryAt ? { nextRetryAt } : {}),
      },
    }),
    prisma.orgWebhookEndpoint.update({
      where: { id: endpointId },
      data: { failCount: { increment: 1 } },
    }),
  ]);

  // Circuit breaker: disable endpoint after 20 consecutive failures
  const endpoint = await prisma.orgWebhookEndpoint.findUnique({
    where: { id: endpointId },
    select: { failCount: true },
  });

  if (endpoint && endpoint.failCount >= 20) {
    await prisma.orgWebhookEndpoint.update({
      where: { id: endpointId },
      data: { status: "DISABLED" },
    });
  }
}
