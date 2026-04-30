import * as jose from "jose";
import { config } from "../config/env.js";
import type { FastifyRequest, FastifyReply } from "fastify";

export interface AuthTokenPayload {
  sub: string;
  email?: string;
  scope?: string;
  client_id?: string;
}

type VerifyKey = Parameters<typeof jose.jwtVerify>[1];

let _verifyKey: VerifyKey | null = null;
let _algorithm: string | null = null;

async function getVerifyKey(): Promise<[VerifyKey, string]> {
  if (_verifyKey && _algorithm) return [_verifyKey, _algorithm];

  if (config.jwtPublicKey) {
    _algorithm = "RS256";
    _verifyKey = (await jose.importSPKI(config.jwtPublicKey, _algorithm)) as unknown as VerifyKey;
  } else if (config.jwtSecret) {
    _algorithm = "HS256";
    _verifyKey = new TextEncoder().encode(config.jwtSecret) as unknown as VerifyKey;
  } else {
    throw new Error("JWT_SECRET or JWT_PUBLIC_KEY must be set");
  }

  return [_verifyKey, _algorithm];
}

export async function verifyBearerToken(token: string): Promise<AuthTokenPayload> {
  const [key, alg] = await getVerifyKey();
  const { payload } = await jose.jwtVerify(token, key, { algorithms: [alg] });
  if (!payload.sub) throw new Error("Token missing sub claim");
  return payload as unknown as AuthTokenPayload;
}

function extractBearer(authorization?: string): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthTokenPayload;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractBearer(request.headers.authorization);
  if (!token) {
    reply.code(401).send({ error: "unauthorized", message: "Bearer token required" });
    return;
  }

  try {
    request.authUser = await verifyBearerToken(token);
  } catch {
    reply.code(401).send({ error: "unauthorized", message: "Invalid or expired token" });
  }
}
