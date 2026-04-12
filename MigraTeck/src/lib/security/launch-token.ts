import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

interface LaunchTokenPayload {
  sub: string;
  orgId: string;
  product: string;
  aud: string;
  nonce: string;
  iat: number;
  exp: number;
}

function getSecret(): string {
  if (env.LAUNCH_TOKEN_SECRET) {
    return env.LAUNCH_TOKEN_SECRET;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("LAUNCH_TOKEN_SECRET must be set in production.");
  }

  return "dev-launch-token-secret";
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createLaunchToken(payload: Omit<LaunchTokenPayload, "exp">, ttlSeconds = 60): string {
  const boundedTtl = Math.max(30, Math.min(ttlSeconds, 90));
  const body: LaunchTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + boundedTtl,
  };

  const encoded = base64UrlEncode(JSON.stringify(body));
  const signature = sign(encoded);

  return `${encoded}.${signature}`;
}

export function verifyLaunchToken(token: string, expectedAudience?: string): LaunchTokenPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = sign(encoded);
  if (signature.length !== expected.length) {
    return null;
  }
  const isValid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!isValid) {
    return null;
  }

  let payload: LaunchTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded)) as LaunchTokenPayload;
  } catch {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  if (expectedAudience && payload.aud !== expectedAudience) {
    return null;
  }

  return payload;
}
