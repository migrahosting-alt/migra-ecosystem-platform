/**
 * MigraPanel → AnnouPale staff bridge — PURE core logic.
 *
 * This module has NO Next.js / server-only / browser imports — it is pure and
 * unit-testable. The server-only entrypoint (`bridge.ts`) wires the real
 * MigraPanel session, environment, and fetch into these functions.
 *
 * It signs a short-lived Ed25519 staff assertion and exchanges it with the
 * AnnouPale token-exchange endpoint. The returned AnnouPale access token is
 * handed back to the SERVER caller only — never logged, never placed in a URL,
 * never serialised to the browser.
 */
import { createPrivateKey, sign as edSign } from "node:crypto";

/** Issuer claim — must match AnnouPale's MIGRATECK_BRIDGE_ISSUER. */
export const BRIDGE_ISSUER = "migrapanel";
/** AnnouPale endpoint path (relative to ANNOUPALE_API_BASE_URL). */
export const EXCHANGE_PATH =
  "/api/integrations/migrateck/staff-token-exchange";
/** Assertions are single-use and short-lived. */
export const ASSERTION_TTL_SECONDS = 60;
/** Re-mint a cached token this many seconds before it actually expires. */
export const TOKEN_REFRESH_SKEW_SECONDS = 60;

export interface BridgeEnv {
  privateKeyPem?: string | undefined;
  keyId?: string | undefined;
  audience?: string | undefined;
  apiBaseUrl?: string | undefined;
}

export interface StaffSession {
  email: string;
  name?: string;
}

export type BridgeFailureReason =
  | "no_staff_session"
  | "missing_env"
  | "denied" // AnnouPale 401 / 403
  | "rate_limited" // AnnouPale 429
  | "bridge_unavailable" // AnnouPale 404 (disabled) / 503 / network error
  | "upstream_error"; // unexpected status / malformed body

export interface IssuedStaffToken {
  accessToken: string;
  expiresAt: string;
  expiresInSeconds: number;
  userId: string;
  email: string;
}

export type BridgeResult =
  | ({ ok: true } & IssuedStaffToken)
  | { ok: false; reason: BridgeFailureReason };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface SignAssertionParams {
  email: string;
  name?: string | undefined;
  privateKeyPem: string;
  keyId: string;
  audience: string;
  issuer?: string;
  nowSeconds: number;
  jti: string;
  ttlSeconds?: number;
}

/**
 * Builds and Ed25519-signs a compact-JWS staff assertion. Pure — no I/O.
 */
export function signStaffAssertion(p: SignAssertionParams): string {
  const header = { alg: "EdDSA", typ: "JWT", kid: p.keyId };
  const iat = p.nowSeconds;
  const exp = iat + (p.ttlSeconds ?? ASSERTION_TTL_SECONDS);
  const payload: Record<string, unknown> = {
    iss: p.issuer ?? BRIDGE_ISSUER,
    sub: p.email,
    email: p.email,
    aud: p.audience,
    iat,
    exp,
    jti: p.jti,
  };
  if (p.name) payload.name = p.name;

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload),
  )}`;
  const key = createPrivateKey(p.privateKeyPem);
  const sig = edSign(null, Buffer.from(signingInput, "utf8"), key);
  return `${signingInput}.${b64url(sig)}`;
}

export interface ResolveDeps {
  session: StaffSession | null;
  env: BridgeEnv;
  fetchImpl: typeof fetch;
  nowSeconds: number;
  makeJti: () => string;
  /** Redaction-safe logger — receives reason codes only, never secrets. */
  log?: (msg: string) => void;
}

/**
 * Full resolve: validate session + env, sign an assertion, exchange it
 * server-side, and map the response to a BridgeResult. Never logs the assertion
 * or the returned token.
 */
export async function resolveStaffToken(
  deps: ResolveDeps,
): Promise<BridgeResult> {
  const { session, env, fetchImpl, nowSeconds, makeJti } = deps;
  const log = deps.log ?? (() => {});

  if (!session?.email) {
    log("no_staff_session");
    return { ok: false, reason: "no_staff_session" };
  }
  if (!env.privateKeyPem || !env.keyId || !env.audience || !env.apiBaseUrl) {
    log("missing_env");
    return { ok: false, reason: "missing_env" };
  }

  let assertion: string;
  try {
    assertion = signStaffAssertion({
      email: session.email,
      name: session.name,
      privateKeyPem: env.privateKeyPem,
      keyId: env.keyId,
      audience: env.audience,
      nowSeconds,
      jti: makeJti(),
    });
  } catch {
    // Bad/garbled key material — a configuration problem, surfaced safely.
    log("sign_failed");
    return { ok: false, reason: "missing_env" };
  }

  const url = `${env.apiBaseUrl.replace(/\/+$/, "")}${EXCHANGE_PATH}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assertion }),
      cache: "no-store",
    });
  } catch {
    log("network_error");
    return { ok: false, reason: "bridge_unavailable" };
  }

  if (res.status === 200) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      log("malformed_success");
      return { ok: false, reason: "upstream_error" };
    }
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as { accessToken?: unknown }).accessToken !== "string"
    ) {
      log("malformed_success");
      return { ok: false, reason: "upstream_error" };
    }
    const d = data as Record<string, unknown>;
    log("granted");
    return {
      ok: true,
      accessToken: d.accessToken as string,
      expiresAt: typeof d.expiresAt === "string" ? d.expiresAt : "",
      expiresInSeconds:
        typeof d.expiresInSeconds === "number" ? d.expiresInSeconds : 0,
      userId: typeof d.userId === "string" ? d.userId : "",
      email: typeof d.email === "string" ? d.email : session.email,
    };
  }

  if (res.status === 401 || res.status === 403) {
    log(`denied_${res.status}`);
    return { ok: false, reason: "denied" };
  }
  if (res.status === 429) {
    log("rate_limited");
    return { ok: false, reason: "rate_limited" };
  }
  if (res.status === 404 || res.status === 503) {
    log(`bridge_unavailable_${res.status}`);
    return { ok: false, reason: "bridge_unavailable" };
  }
  log(`upstream_error_${res.status}`);
  return { ok: false, reason: "upstream_error" };
}

interface CacheEntry {
  token: IssuedStaffToken;
  expiresAtSeconds: number;
}

/**
 * Optional in-process, per-staff-user token cache. Server memory only — never
 * persisted, never sent to the browser. Entries are evicted a skew window
 * before real expiry so a near-dead token is never handed out.
 */
export class StaffTokenCache {
  private readonly store = new Map<string, CacheEntry>();

  get(email: string, nowSeconds: number): IssuedStaffToken | null {
    const entry = this.store.get(email);
    if (!entry) return null;
    if (entry.expiresAtSeconds - TOKEN_REFRESH_SKEW_SECONDS <= nowSeconds) {
      this.store.delete(email);
      return null;
    }
    return entry.token;
  }

  set(email: string, token: IssuedStaffToken, nowSeconds: number): void {
    const ttl = token.expiresInSeconds > 0 ? token.expiresInSeconds : 0;
    if (ttl <= 0) return; // don't cache something we can't age out
    this.store.set(email, { token, expiresAtSeconds: nowSeconds + ttl });
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Resolve the AnnouPale bridge operator identity (the assertion email).
 *
 * SERVER-AUTHORITATIVE: MigraPanel is a single-admin console, so a logged-in
 * console admin acts as the configured AnnouPale operator. The session is used
 * ONLY to prove authentication (the `authenticated` boolean) — the operator
 * email is taken solely from server env and is NEVER read from the browser, the
 * session cookie value, query params, form data, headers, or client props.
 *
 * Source order: ANNOUPALE_BRIDGE_OPERATOR_EMAIL (decoupled from the console
 * login email), else CONSOLE_ADMIN_EMAIL. Returns null when not authenticated
 * or no operator email is configured (→ safe failure upstream).
 */
export function resolveBridgeOperatorEmail(
  authenticated: boolean,
  env: {
    operatorEmail?: string | null | undefined;
    consoleAdminEmail?: string | null | undefined;
  },
): string | null {
  if (!authenticated) return null;
  const email = (env.operatorEmail || env.consoleAdminEmail || "")
    .trim()
    .toLowerCase();
  return email.length > 0 ? email : null;
}
