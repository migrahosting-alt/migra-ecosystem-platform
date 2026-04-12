import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authAccessTokenSecret, authAccessTokenTtlSeconds } from "@/lib/env";

export type AccessTokenRole = "OWNER" | "ADMIN" | "BILLING" | "MEMBER" | "READONLY";

export interface AccessTokenPayload {
  sub: string;
  orgId: string;
  role: AccessTokenRole;
  email: string;
  type: "access";
}

interface SignedAccessTokenPayload extends AccessTokenPayload {
  exp: number;
  iat: number;
}

const ACCESS_TOKEN_ROLE_SET = new Set<AccessTokenRole>(["OWNER", "ADMIN", "BILLING", "MEMBER", "READONLY"]);

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signTokenParts(headerSegment: string, payloadSegment: string): string {
  return createHmac("sha256", authAccessTokenSecret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");
}

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid access token field: ${fieldName}`);
  }

  return value;
}

function assertNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid access token field: ${fieldName}`);
  }

  return value;
}

function parseAccessTokenPayload(value: unknown): SignedAccessTokenPayload {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid access token payload");
  }

  const payload = value as Record<string, unknown>;
  const role = assertString(payload.role, "role") as AccessTokenRole;

  if (!ACCESS_TOKEN_ROLE_SET.has(role)) {
    throw new Error("Invalid access token role");
  }

  const type = assertString(payload.type, "type");
  if (type !== "access") {
    throw new Error("Invalid access token type");
  }

  return {
    sub: assertString(payload.sub, "sub"),
    orgId: assertString(payload.orgId, "orgId"),
    role,
    email: assertString(payload.email, "email"),
    type: "access",
    exp: assertNumber(payload.exp, "exp"),
    iat: assertNumber(payload.iat, "iat"),
  };
}

export function signAccessToken(payload: AccessTokenPayload, expiresInSeconds = authAccessTokenTtlSeconds): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokenPayload: SignedAccessTokenPayload = {
    ...payload,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
  };
  const headerSegment = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadSegment = encodeBase64Url(JSON.stringify(tokenPayload));
  const signatureSegment = signTokenParts(headerSegment, payloadSegment);

  return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment || token.split(".").length !== 3) {
    throw new Error("Invalid access token format");
  }

  const header = JSON.parse(decodeBase64Url(headerSegment)) as Record<string, unknown>;
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("Invalid access token header");
  }

  const expectedSignature = signTokenParts(headerSegment, payloadSegment);
  const actualBuffer = Buffer.from(signatureSegment);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Invalid access token signature");
  }

  const payload = parseAccessTokenPayload(JSON.parse(decodeBase64Url(payloadSegment)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error("Access token expired");
  }

  return {
    sub: payload.sub,
    orgId: payload.orgId,
    role: payload.role,
    email: payload.email,
    type: payload.type,
  };
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}