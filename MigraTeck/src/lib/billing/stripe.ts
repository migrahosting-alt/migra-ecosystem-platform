import { createHmac, timingSafeEqual } from "node:crypto";
import { stripeWebhookToleranceSeconds } from "@/lib/env";

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
  livemode?: boolean;
}

function parseStripeSignatureHeader(header: string): { timestamp: number; signatures: string[] } | null {
  const pairs = header
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.split("="))
    .filter((pair) => pair.length === 2);

  const timestampRaw = pairs.find(([key]) => key === "t")?.[1];
  const signatures = pairs.filter(([key]) => key === "v1").map(([, value]) => value).filter((value): value is string => Boolean(value));

  if (!timestampRaw || signatures.length === 0) {
    return null;
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return { timestamp, signatures };
}

function equalsHexSignature(expected: string, provided: string): boolean {
  try {
    const expectedBuffer = Buffer.from(expected, "hex");
    const providedBuffer = Buffer.from(provided, "hex");

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string, webhookSecret: string): boolean {
  const parsedHeader = parseStripeSignatureHeader(signatureHeader);
  if (!parsedHeader) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsedHeader.timestamp) > stripeWebhookToleranceSeconds) {
    return false;
  }

  const signedPayload = `${parsedHeader.timestamp}.${rawBody}`;
  const expected = createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");

  return parsedHeader.signatures.some((signature) => equalsHexSignature(expected, signature));
}

export function parseStripeEvent(rawBody: string): StripeEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as StripeEvent;

    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string" || typeof parsed.type !== "string") {
      return null;
    }

    if (!parsed.data || typeof parsed.data !== "object" || !parsed.data.object || typeof parsed.data.object !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
