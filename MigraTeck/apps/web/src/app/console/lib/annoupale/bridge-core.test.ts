import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ASSERTION_TTL_SECONDS,
  BRIDGE_ISSUER,
  EXCHANGE_PATH,
  resolveStaffToken,
  signStaffAssertion,
  StaffTokenCache,
  type BridgeEnv,
} from "./bridge-core.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- key material (ephemeral, per test run) --------------------------------
const kp = generateKeyPairSync("ed25519");
const PRIVATE_PEM = kp.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const PUBLIC_KEY: KeyObject = kp.publicKey;

const NOW = 1_700_000_000;
const AUDIENCE = "annoupale";
const API_BASE = "http://127.0.0.1:3100";

function fullEnv(): BridgeEnv {
  return {
    privateKeyPem: PRIVATE_PEM,
    keyId: "k1",
    audience: AUDIENCE,
    apiBaseUrl: API_BASE,
  };
}

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// === 1. refuses without staff session ======================================
test("refuses without a staff session and does not call fetch", async () => {
  let called = false;
  const res = await resolveStaffToken({
    session: null,
    env: fullEnv(),
    fetchImpl: (async () => {
      called = true;
      return jsonResponse({}, 200);
    }) as unknown as typeof fetch,
    nowSeconds: NOW,
    makeJti: () => "jti-1",
  });
  assert.deepEqual(res, { ok: false, reason: "no_staff_session" });
  assert.equal(called, false);
});

// === 2. refuses missing env ================================================
test("refuses when env is incomplete and does not call fetch", async () => {
  let called = false;
  const res = await resolveStaffToken({
    session: { email: "a@migrateck.com" },
    env: { privateKeyPem: PRIVATE_PEM }, // missing keyId/audience/apiBaseUrl
    fetchImpl: (async () => {
      called = true;
      return jsonResponse({}, 200);
    }) as unknown as typeof fetch,
    nowSeconds: NOW,
    makeJti: () => "jti-1",
  });
  assert.deepEqual(res, { ok: false, reason: "missing_env" });
  assert.equal(called, false);
});

// === 3 & 4. signs required claims with short exp ============================
test("signs an assertion with the required claims, EdDSA header, and 60s exp", () => {
  const assertion = signStaffAssertion({
    email: "admin@migrateck.com",
    name: "Ops Admin",
    privateKeyPem: PRIVATE_PEM,
    keyId: "k1",
    audience: AUDIENCE,
    nowSeconds: NOW,
    jti: "jti-xyz",
  });
  const [h, p, s] = assertion.split(".");
  const header = decodeSegment(h!);
  const payload = decodeSegment(p!);

  assert.equal(header.alg, "EdDSA");
  assert.equal(header.typ, "JWT");
  assert.equal(header.kid, "k1");

  assert.equal(payload.iss, BRIDGE_ISSUER);
  assert.equal(payload.sub, "admin@migrateck.com");
  assert.equal(payload.email, "admin@migrateck.com");
  assert.equal(payload.name, "Ops Admin");
  assert.equal(payload.aud, AUDIENCE);
  assert.equal(payload.iat, NOW);
  assert.equal((payload.exp as number) - (payload.iat as number), ASSERTION_TTL_SECONDS);
  assert.equal(payload.jti, "jti-xyz");

  // Signature must verify against the public key over header.payload.
  const ok = edVerify(
    null,
    Buffer.from(`${h}.${p}`, "utf8"),
    PUBLIC_KEY,
    Buffer.from(s!, "base64url"),
  );
  assert.equal(ok, true);
});

// === 5. sends the assertion server-side to the correct endpoint =============
test("POSTs the assertion to the exchange endpoint server-side", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  await resolveStaffToken({
    session: { email: "admin@migrateck.com" },
    env: fullEnv(),
    fetchImpl: (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return jsonResponse(
        { accessToken: "tok", expiresAt: "x", expiresInSeconds: 900, userId: "u1", email: "admin@migrateck.com" },
        200,
      );
    }) as unknown as typeof fetch,
    nowSeconds: NOW,
    makeJti: () => "jti-1",
  });
  assert.ok(captured);
  const c = captured as { url: string; init: RequestInit };
  assert.equal(c.url, `${API_BASE}${EXCHANGE_PATH}`);
  assert.equal(c.init.method, "POST");
  const body = JSON.parse(c.init.body as string);
  assert.equal(typeof body.assertion, "string");
  assert.ok(body.assertion.split(".").length === 3);
});

// === 6. handles 200 and returns the token to the server caller ==============
test("returns the token on 200", async () => {
  const res = await resolveStaffToken({
    session: { email: "admin@migrateck.com" },
    env: fullEnv(),
    fetchImpl: (async () =>
      jsonResponse(
        { accessToken: "ACCESS-TOK", expiresAt: "2026-01-01T00:15:00.000Z", expiresInSeconds: 900, userId: "u1", email: "admin@migrateck.com" },
        200,
      )) as unknown as typeof fetch,
    nowSeconds: NOW,
    makeJti: () => "jti-1",
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.accessToken, "ACCESS-TOK");
    assert.equal(res.expiresInSeconds, 900);
    assert.equal(res.userId, "u1");
  }
});

// === 7. handles 401/403/429/404/503/other safely ===========================
test("maps upstream error statuses to safe reasons", async () => {
  const cases: Array<[number, string]> = [
    [401, "denied"],
    [403, "denied"],
    [429, "rate_limited"],
    [404, "bridge_unavailable"],
    [503, "bridge_unavailable"],
    [500, "upstream_error"],
  ];
  for (const [status, reason] of cases) {
    const res = await resolveStaffToken({
      session: { email: "admin@migrateck.com" },
      env: fullEnv(),
      fetchImpl: (async () => jsonResponse({ error: "x" }, status)) as unknown as typeof fetch,
      nowSeconds: NOW,
      makeJti: () => "jti-1",
    });
    assert.deepEqual(res, { ok: false, reason }, `status ${status}`);
  }
});

test("maps a network failure to bridge_unavailable", async () => {
  const res = await resolveStaffToken({
    session: { email: "admin@migrateck.com" },
    env: fullEnv(),
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
    nowSeconds: NOW,
    makeJti: () => "jti-1",
  });
  assert.deepEqual(res, { ok: false, reason: "bridge_unavailable" });
});

// === 8. never logs the assertion or the returned token =====================
test("never logs the assertion or the access token", async () => {
  const logs: string[] = [];
  const SECRET_TOKEN = "SUPER-SECRET-ACCESS-TOKEN";
  await resolveStaffToken({
    session: { email: "admin@migrateck.com" },
    env: fullEnv(),
    fetchImpl: (async () =>
      jsonResponse(
        { accessToken: SECRET_TOKEN, expiresAt: "x", expiresInSeconds: 900, userId: "u1", email: "admin@migrateck.com" },
        200,
      )) as unknown as typeof fetch,
    nowSeconds: NOW,
    makeJti: () => "jti-1",
    log: (m) => logs.push(m),
  });
  const all = logs.join("\n");
  assert.equal(all.includes(SECRET_TOKEN), false);
  assert.equal(all.includes("."), false); // no JWS-looking content
  assert.ok(all.includes("granted"));
});

// === 9. server-only boundary is enforced in source =========================
test("bridge.ts imports server-only; bridge-core.ts has no server/browser imports", () => {
  const wrapper = readFileSync(join(HERE, "bridge.ts"), "utf8");
  assert.ok(
    /import\s+["']server-only["']/.test(wrapper),
    "bridge.ts must import 'server-only'",
  );

  const core = readFileSync(join(HERE, "bridge-core.ts"), "utf8");
  // Must not IMPORT server-only / next / react (substring checks would match
  // the doc comment, so match real import statements instead).
  assert.ok(
    !/import\s+["']server-only["']/.test(core),
    "bridge-core.ts must not import 'server-only'",
  );
  assert.ok(
    !/from\s+["']next\//.test(core),
    "bridge-core.ts must not import from next/*",
  );
  assert.ok(
    !/from\s+["']react/.test(core),
    "bridge-core.ts must not import from react",
  );
  // Must not touch browser globals at all.
  for (const g of ["window.", "localStorage", "document."]) {
    assert.equal(core.includes(g), false, `bridge-core.ts must not use ${g}`);
  }
});

// === cache behaviour =======================================================
test("StaffTokenCache returns a fresh token, evicts near expiry, isolates users", () => {
  const cache = new StaffTokenCache();
  const tok = { accessToken: "t", expiresAt: "x", expiresInSeconds: 900, userId: "u1", email: "a@x.com" };
  cache.set("a@x.com", tok, NOW);

  assert.deepEqual(cache.get("a@x.com", NOW), tok); // fresh
  assert.equal(cache.get("b@x.com", NOW), null); // different user
  // within the refresh-skew window -> evicted
  assert.equal(cache.get("a@x.com", NOW + 900 - 30), null);

  // zero-ttl tokens are not cached
  cache.set("c@x.com", { ...tok, expiresInSeconds: 0 }, NOW);
  assert.equal(cache.get("c@x.com", NOW), null);
});

import { resolveBridgeOperatorEmail } from "./bridge-core.ts";

test("operator identity: not authenticated → null (no exchange)", () => {
  assert.equal(
    resolveBridgeOperatorEmail(false, { operatorEmail: "op@x.com" }),
    null,
  );
});

test("operator identity: authenticated → server ANNOUPALE_BRIDGE_OPERATOR_EMAIL", () => {
  assert.equal(
    resolveBridgeOperatorEmail(true, {
      operatorEmail: "Ops@Operator.example ",
      consoleAdminEmail: "login@console.example",
    }),
    "ops@operator.example", // trimmed + lowercased; operator wins over console-admin
  );
});

test("operator identity: falls back to CONSOLE_ADMIN_EMAIL when operator unset", () => {
  assert.equal(
    resolveBridgeOperatorEmail(true, { consoleAdminEmail: "login@console.example" }),
    "login@console.example",
  );
});

test("operator identity: stale/login session email is irrelevant (env-only source)", () => {
  // The function has no session-email parameter at all → a stale or different
  // login email can never become the bridge identity, and a client cannot
  // override it. Identity comes only from the env object.
  assert.equal(
    resolveBridgeOperatorEmail(true, { operatorEmail: "op@operator.example" }),
    "op@operator.example",
  );
});

test("operator identity: missing both → null (safe failure)", () => {
  assert.equal(resolveBridgeOperatorEmail(true, {}), null);
  assert.equal(
    resolveBridgeOperatorEmail(true, { operatorEmail: "", consoleAdminEmail: "" }),
    null,
  );
});
