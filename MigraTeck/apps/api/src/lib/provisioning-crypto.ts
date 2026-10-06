import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => [key, normalize(nested)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(entries);
  }
  return value;
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonicalPayload(payload: unknown): string {
  return sha256Hex(canonicalizeJson(payload));
}

export type ProvisioningEnvelopeCore = {
  jobId: string;
  orgId: string;
  type: string;
  payloadHash: string;
  createdAt: string;
  expiresAt?: string | null;
  envelopeVersion: number;
};

function envelopeSecret(): string {
  const value = process.env.JOB_ENVELOPE_SIGNING_SECRET?.trim();
  if (!value) {
    throw new Error("JOB_ENVELOPE_SIGNING_SECRET is required");
  }
  return value;
}

function canonicalEnvelope(input: ProvisioningEnvelopeCore): string {
  return [
    "v=" + input.envelopeVersion,
    "jobId=" + input.jobId,
    "orgId=" + input.orgId,
    "type=" + input.type,
    "payloadHash=" + input.payloadHash,
    "createdAt=" + input.createdAt,
    "expiresAt=" + (input.expiresAt || ""),
  ].join("|");
}

function secureEqualsHex(expected: string, provided: string): boolean {
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function signProvisioningEnvelope(input: ProvisioningEnvelopeCore): string {
  return createHmac("sha256", envelopeSecret())
    .update(canonicalEnvelope(input))
    .digest("hex");
}

export function verifyProvisioningEnvelope(
  input: ProvisioningEnvelopeCore & { signature: string },
): boolean {
  return secureEqualsHex(signProvisioningEnvelope(input), input.signature);
}

export function signProvisioningDispatch(payload: unknown, token: string): string {
  return createHmac("sha256", token).update(canonicalizeJson(payload)).digest("hex");
}
