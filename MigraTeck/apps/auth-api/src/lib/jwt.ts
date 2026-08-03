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
  email?: string;
  email_verified: boolean;
  scope: string;
  client_id: string;
}

export interface IdTokenPayload {
  sub: string;
  email?: string;
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

/**
 * How a resource server treats the audience binding during migration.
 *
 * There is no default. A verifier that silently omits the audience check is exactly how
 * every first-party token became valid at every first-party service, so the choice is
 * made explicit at each call site and shows up in review.
 */
export type AudienceMode = "observe" | "enforce";

/** Reported when a token's audience is not the one this resource server expects. */
export interface AudienceMismatch {
  expectedAudience: string;
  /** The `aud` the token actually carried. `undefined` when it carried none. */
  tokenAudience: string | string[] | undefined;
  clientId?: string;
  subject?: string;
  issuer?: string;
}

export interface VerifyAccessTokenOptions {
  issuer: string;
  /** The audience THIS resource server is. Never taken from the request. */
  audience: string;
  audienceMode: AudienceMode;
  /**
   * Called on mismatch in `observe` mode. Receives identifiers only — never the token,
   * never a segment of it. A security log that leaks the credential it is warning about
   * is worse than no log.
   */
  onAudienceMismatch?: (event: AudienceMismatch) => void;
}

/**
 * Verify an access token FOR A PARTICULAR RESOURCE SERVER.
 *
 * `issueAccessToken` has always bound the audience to the requesting client, but this
 * verifier passed only `{ issuer }` to `jose`, which enforces `aud` solely when an
 * expected audience is supplied. The binding was therefore written at issuance and
 * discarded at verification: because every first-party client shares one issuer and one
 * signing key, a token minted for `migrahosting_web` verified successfully anywhere.
 *
 * `enforce` refuses a missing or foreign audience. `observe` admits it and reports it, so
 * a consumer can be measured before it is tightened — enabling rejection in the same
 * deployment that first adds telemetry would break unknown callers before anyone could
 * see them.
 */
export async function verifyAccessToken(
  token: string,
  options: VerifyAccessTokenOptions,
): Promise<jose.JWTPayload & AccessTokenPayload> {
  await ensureKeys();
  if (options?.audienceMode !== "observe" && options?.audienceMode !== "enforce") {
    throw new Error("verifyAccessToken requires an explicit audienceMode of 'observe' or 'enforce'.");
  }

  const { payload } = await jose.jwtVerify(token, verifyKey, {
    issuer: options.issuer,
    ...(options.audienceMode === "enforce" ? { audience: options.audience } : {}),
  });

  if (options.audienceMode === "observe") {
    const aud = payload.aud;
    const matches = Array.isArray(aud) ? aud.includes(options.audience) : aud === options.audience;
    if (!matches) {
      options.onAudienceMismatch?.({
        expectedAudience: options.audience,
        tokenAudience: aud,
        clientId: typeof payload["client_id"] === "string" ? payload["client_id"] : undefined,
        subject: payload.sub,
        issuer: payload.iss,
      });
    }
  }

  return payload as jose.JWTPayload & AccessTokenPayload;
}

/**
 * Verify a token this issuer minted, without binding it to one resource server.
 *
 * For the identity provider's OWN endpoints (`/userinfo`, session management), where any
 * token MigraAuth issued is legitimately in scope. Deliberately a separate, named function
 * rather than an "accept any audience" mode: the two are different decisions, and giving
 * the permissive one its own name keeps it from becoming the convenient default elsewhere.
 */
export async function verifyIssuedToken(
  token: string,
): Promise<jose.JWTPayload & AccessTokenPayload> {
  await ensureKeys();
  const { payload } = await jose.jwtVerify(token, verifyKey, { issuer: config.jwtIssuer });
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
