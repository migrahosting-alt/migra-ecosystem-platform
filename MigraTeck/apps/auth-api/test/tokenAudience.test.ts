// MigraAuth — access-token audience.
//
// WHY THIS FILE EXISTS. `issueAccessToken` binds every token to the client that asked
// for it:
//
//     .setAudience(payload.client_id)
//
// but `verifyAccessToken` verifies only the issuer:
//
//     jose.jwtVerify(token, verifyKey, { issuer: config.jwtIssuer })
//
// `jose` enforces `aud` only when an expected audience is supplied, so the binding is
// written at issuance and discarded at verification. Every first-party client shares one
// issuer and one signing key, which means a token minted for `migrahosting_web` verifies
// successfully at any other resource server that calls this function — the separation
// between products exists on paper and not in the check.
//
// Test 1 performs exactly that: it mints a token for one client and presents it as
// another, and asserts it is refused. It fails against the verifier as written, which is
// the point — a test that passed against the defect would be proving nothing.
//
// The seeded first-party clients (`migrateck_web`, `migrahosting_web`, `migradrive_web`,
// `migramail_web`, `migrapanel_web`, `migravoice_web`) all carry audience == client_id,
// so this is the model any audience enforcement has to work within. © MigraTeck LLC.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as jose from "jose";
import { issueAccessToken, verifyAccessToken } from "../src/lib/jwt.js";
import { config } from "../src/config/env.js";

const PORTAL = "migrahosting_web";
const PILOT = "migrapilot-consumer-web";

const claims = (clientId: string) => ({
  sub: "user_00000000-0000-4000-8000-000000000001",
  email: "person@example.test",
  email_verified: true,
  scope: "openid profile email",
  client_id: clientId,
});

/** What a resource server actually holds: the issuer it trusts and the audience it is. */
const EXPECTED_ISSUER = config.jwtIssuer;

test("1 — a token minted for one client must not verify as another", async () => {
  // The defect, stated as a security property. A MigraHosting portal token presented to
  // MigraPilot is a cross-product credential replay, and the only thing that can refuse
  // it is an audience check at the verifier.
  const portalToken = await issueAccessToken(claims(PORTAL));

  const decoded = jose.decodeJwt(portalToken);
  assert.equal(decoded.aud, PORTAL, "issuance must bind the audience to the client");

  await assert.rejects(
    () => verifyAccessToken(portalToken, { issuer: EXPECTED_ISSUER, audience: PILOT, audienceMode: "enforce" }),
    "a portal token verified successfully against MigraPilot's audience",
  );
});

test("2 — a token verifies for the audience it was actually issued to", async () => {
  // The guard is only worth having if the legitimate case still works.
  const pilotToken = await issueAccessToken(claims(PILOT));
  const payload = await verifyAccessToken(pilotToken, {
    issuer: EXPECTED_ISSUER,
    audience: PILOT,
    audienceMode: "enforce",
  });
  assert.equal(payload.sub, claims(PILOT).sub);
  assert.equal(payload.client_id, PILOT);
});

test("3 — a wrong issuer is refused regardless of audience", async () => {
  const token = await issueAccessToken(claims(PILOT));
  await assert.rejects(
    () => verifyAccessToken(token, { issuer: "https://impostor.example", audience: PILOT, audienceMode: "enforce" }),
    "a token from an unexpected issuer was accepted",
  );
});

test("4 — an expired token is refused", async () => {
  const token = await issueAccessToken(claims(PILOT), -1);
  await assert.rejects(
    () => verifyAccessToken(token, { issuer: EXPECTED_ISSUER, audience: PILOT, audienceMode: "enforce" }),
    "an expired token was accepted",
  );
});

test("5 — a token carrying no audience is refused in enforce mode", async () => {
  // Not hypothetical: a token minted before audiences were bound, or by a path that
  // forgets to set one, must not be treated as valid everywhere.
  const noAud = await new jose.SignJWT({ ...claims(PILOT), type: "access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(EXPECTED_ISSUER)
    .setSubject(claims(PILOT).sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(config.jwtSecret));

  await assert.rejects(
    () => verifyAccessToken(noAud, { issuer: EXPECTED_ISSUER, audience: PILOT, audienceMode: "enforce" }),
    "a token with no audience was accepted in enforce mode",
  );
});

test("6 — observe mode reports a mismatch without rejecting it", async () => {
  // The migration path. Rejecting on the same deployment that first adds telemetry would
  // break unknown consumers before anyone could see them, so observe reports and admits.
  const portalToken = await issueAccessToken(claims(PORTAL));
  const observed: Array<{ expected: string; actual: unknown }> = [];

  const payload = await verifyAccessToken(portalToken, {
    issuer: EXPECTED_ISSUER,
    audience: PILOT,
    audienceMode: "observe",
    onAudienceMismatch: (event) => observed.push({ expected: event.expectedAudience, actual: event.tokenAudience }),
  });

  assert.equal(payload.client_id, PORTAL, "observe mode must still return the payload");
  assert.equal(observed.length, 1, "the mismatch was not recorded");
  assert.equal(observed[0]?.expected, PILOT);
  assert.equal(observed[0]?.actual, PORTAL);
});

test("7 — observe mode stays silent when the audience matches", async () => {
  const pilotToken = await issueAccessToken(claims(PILOT));
  const observed: unknown[] = [];
  await verifyAccessToken(pilotToken, {
    issuer: EXPECTED_ISSUER,
    audience: PILOT,
    audienceMode: "observe",
    onAudienceMismatch: (event) => observed.push(event),
  });
  assert.deepEqual(observed, [], "a matching audience must not raise a mismatch");
});

test("8 — telemetry never carries the raw token", async () => {
  // A security log that leaks the credential it is warning about is worse than no log.
  const portalToken = await issueAccessToken(claims(PORTAL));
  let captured: Record<string, unknown> | undefined;
  await verifyAccessToken(portalToken, {
    issuer: EXPECTED_ISSUER,
    audience: PILOT,
    audienceMode: "observe",
    onAudienceMismatch: (event) => { captured = event as unknown as Record<string, unknown>; },
  });
  assert.ok(captured, "no mismatch event was emitted");
  const serialized = JSON.stringify(captured);
  assert.equal(serialized.includes(portalToken), false, "the raw token appeared in telemetry");
  for (const segment of portalToken.split(".")) {
    assert.equal(serialized.includes(segment), false, "a token segment appeared in telemetry");
  }
});

test("9 — there is no implicit default audience mode", async () => {
  // A verifier that silently omits the audience check is how this defect existed at all.
  // Callers must state which behaviour they want.
  const portalToken = await issueAccessToken(claims(PORTAL));
  await assert.rejects(
    () => verifyAccessToken(portalToken, { issuer: EXPECTED_ISSUER, audience: PILOT } as never),
    "omitting audienceMode silently accepted a foreign audience",
  );
});
