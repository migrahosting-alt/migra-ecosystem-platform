/**
 * JWT token issuing and verification — HMAC-SHA256 (dev) / RS256 (prod).
 * Uses the `jose` library for standards-compliant JWT handling.
 */
import * as jose from "jose";
import { config } from "../config/env.js";

// ── Key material ────────────────────────────────────────────────────

// jose v6 returns CryptoKey|KeyObject depending on runtime; use an opaque union.
type SignKey = Parameters<typeof jose.SignJWT.prototype.sign>[0];
let signingKey: SignKey;
let verifyKey: SignKey;
let algorithm: string;
let jwksCache: jose.JWK | undefined;

async function ensureKeys(): Promise<void> {
  if (signingKey) return;

  if (config.jwtPrivateKey && config.jwtPublicKey) {
    // Production: RSA key pair
    algorithm = "RS256";
    signingKey = await jose.importPKCS8(config.jwtPrivateKey, algorithm);
    verifyKey = await jose.importSPKI(config.jwtPublicKey, algorithm);
    jwksCache = await jose.exportJWK(verifyKey);
    jwksCache.kid = "migraauth-1";
    jwksCache.alg = algorithm;
    jwksCache.use = "sig";
  } else {
    // Development: HMAC symmetric key
    algorithm = "HS256";
    signingKey = new TextEncoder().encode(config.jwtSecret);
    verifyKey = signingKey;
  }
}

// ── Token types ─────────────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  scope: string;
  client_id: string;
}

export interface IdTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

// ── Issue tokens ────────────────────────────────────────────────────

export async function issueAccessToken(
  payload: AccessTokenPayload,
  ttlSeconds?: number,
): Promise<string> {
  await ensureKeys();
  return new jose.SignJWT({ ...payload, type: "access" })
    .setProtectedHeader({ alg: algorithm, typ: "JWT" })
    .setIssuer(config.jwtIssuer)
    .setAudience(payload.client_id)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds ?? config.accessTokenTtl}s`)
    .sign(signingKey);
}

export async function issueIdToken(
  payload: IdTokenPayload,
  audience: string,
  nonce?: string,
): Promise<string> {
  await ensureKeys();
  const builder = new jose.SignJWT({
    ...payload,
    type: "id_token",
    ...(nonce ? { nonce } : {}),
  })
    .setProtectedHeader({ alg: algorithm, typ: "JWT" })
    .setIssuer(config.jwtIssuer)
    .setAudience(audience)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtl}s`);
  return builder.sign(signingKey);
}

// ── Verify tokens ───────────────────────────────────────────────────

export async function verifyAccessToken(
  token: string,
): Promise<jose.JWTPayload & AccessTokenPayload> {
  await ensureKeys();
  const { payload } = await jose.jwtVerify(token, verifyKey, {
    issuer: config.jwtIssuer,
  });
  return payload as jose.JWTPayload & AccessTokenPayload;
}

// ── JWKS ────────────────────────────────────────────────────────────

export async function getJWKS(): Promise<{ keys: jose.JWK[] }> {
  await ensureKeys();
  if (jwksCache) {
    return { keys: [jwksCache] };
  }
  // HMAC mode — no public JWKS
  return { keys: [] };
}

export async function getOpenIDConfiguration() {
  return {
    issuer: config.jwtIssuer,
    authorization_endpoint: `${config.publicUrl}/authorize`,
    token_endpoint: `${config.publicUrl}/token`,
    userinfo_endpoint: `${config.publicUrl}/userinfo`,
    revocation_endpoint: `${config.publicUrl}/revoke`,
    jwks_uri: `${config.publicUrl}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: [algorithm],
    scopes_supported: ["openid", "profile", "email", "offline_access", "orgs:read"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
  };
}
