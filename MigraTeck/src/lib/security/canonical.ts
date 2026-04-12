import { createHash } from "node:crypto";

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
