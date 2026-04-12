import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

interface ProvisioningEnvelopeCore {
  jobId: string;
  orgId: string;
  type: string;
  payloadHash: string;
  createdAt: string;
  expiresAt?: string | null;
  envelopeVersion: number;
}

function envelopeSecret(): string {
  if (env.JOB_ENVELOPE_SIGNING_SECRET) {
    return env.JOB_ENVELOPE_SIGNING_SECRET;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("JOB_ENVELOPE_SIGNING_SECRET is required in production.");
  }

  return "dev-job-envelope-secret";
}

function canonicalEnvelope(input: ProvisioningEnvelopeCore): string {
  return [
    `v=${input.envelopeVersion}`,
    `jobId=${input.jobId}`,
    `orgId=${input.orgId}`,
    `type=${input.type}`,
    `payloadHash=${input.payloadHash}`,
    `createdAt=${input.createdAt}`,
    `expiresAt=${input.expiresAt || ""}`,
  ].join("|");
}

function secureEqualsHex(expected: string, provided: string): boolean {
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length) {
      return false;
    }

    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function signJobEnvelope(input: ProvisioningEnvelopeCore): string {
  return createHmac("sha256", envelopeSecret()).update(canonicalEnvelope(input)).digest("hex");
}

export function verifyJobEnvelope(input: ProvisioningEnvelopeCore & { signature: string }): boolean {
  const expected = signJobEnvelope(input);
  return secureEqualsHex(expected, input.signature);
}
