// MigraAuth — active organization across the real OAuth flow.
//
// `activeOrganization.test.ts` proves the DECISIONS. This proves they survive the round
// trip: /authorize → authorization code → token exchange → refresh, against a real
// Postgres with the real Prisma client. The decisions being right is worth nothing if the
// binding is lost between the code and the token, or if the token endpoint can be talked
// into a different organization than the one the user consented to.
//
// Requires a DISPOSABLE database. Set AUTH_DATABASE_URL to one and the suite runs; leave
// it unset and every test skips rather than silently passing, because a green run against
// no database would be the most misleading possible result. Never point this at
// production. © MigraTeck LLC.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import * as jose from "jose";
import { db } from "../src/lib/db.js";
import { createAuthCode, exchangeAuthCode, rotateRefreshToken } from "../src/modules/tokens/index.js";
import { loadMemberships } from "../src/modules/organizations/memberships.js";

const HAVE_DB = Boolean(process.env["AUTH_DATABASE_URL"]);
const opts = HAVE_DB ? {} : { skip: "AUTH_DATABASE_URL is not set (disposable Postgres required)" };

// PKCE pair fixed so the verifier matches the challenge deterministically.
const VERIFIER = "a".repeat(64);
const CHALLENGE = jose.base64url.encode(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER))),
);

const REDIRECT = "https://chat.example.test/auth/callback";

interface Fixture {
  userId: string;
  orgA: string;
  orgB: string;
  boundClient: string;
  legacyClient: string;
}

/** A fresh, independent world per test: unique ids everywhere, no shared mutable state. */
async function fixture(over: { requiresOrg?: boolean } = {}): Promise<Fixture> {
  const uniq = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const boundClient = `bound_${uniq}`;
  const legacyClient = `legacy_${uniq}`;

  await db.user.create({
    data: { id: userId, email: `u_${uniq}@example.test`, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  for (const [id, name] of [[orgA, `A_${uniq}`], [orgB, `B_${uniq}`]] as const) {
    await db.organization.create({ data: { id, name, slug: `${name.toLowerCase()}`, ownerUserId: userId } });
  }
  await db.oAuthClient.create({
    data: {
      clientId: boundClient, clientName: "Bound", clientType: "web",
      redirectUris: [REDIRECT], allowedScopes: ["openid", "profile", "email"],
      requiresActiveOrganization: over.requiresOrg ?? true,
    },
  });
  await db.oAuthClient.create({
    data: {
      clientId: legacyClient, clientName: "Legacy", clientType: "web",
      redirectUris: [REDIRECT], allowedScopes: ["openid"],
      requiresActiveOrganization: false,
    },
  });
  return { userId, orgA, orgB, boundClient, legacyClient };
}

const join = (userId: string, organizationId: string, status: "ACTIVE" | "INVITED" | "SUSPENDED", role: "OWNER" | "MEMBER" = "MEMBER") =>
  db.organizationMember.create({ data: { userId, organizationId, status, role, joinedAt: new Date() } });

const mintCode = (f: Fixture, clientId: string, organizationId?: string) =>
  createAuthCode(f.userId, clientId, REDIRECT, CHALLENGE, "S256", ["openid"], undefined,
    organizationId ? { organizationId } : {});

const claims = (token: string) => jose.decodeJwt(token) as Record<string, unknown>;

// ── 1-3. The code carries the binding, and the exchange reads it ─────────────

test("1 — the selected organization is stored on the authorization code", opts, async () => {
  const f = await fixture();
  await join(f.userId, f.orgA, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);

  const row = await db.oAuthAuthorizationCode.findFirst({ where: { clientId: f.boundClient }, orderBy: { createdAt: "desc" } });
  assert.equal(row?.organizationId, f.orgA);
  void code;
});

test("2 — token exchange reads the code-bound organization", opts, async () => {
  const f = await fixture();
  await join(f.userId, f.orgA, "ACTIVE", "OWNER");
  const code = await mintCode(f, f.boundClient, f.orgA);

  const tokens = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.ok(tokens, "exchange failed");
  const access = claims(tokens.access_token);
  assert.equal(access["org_id"], f.orgA);
  assert.deepEqual(access["org_roles"], ["OWNER"]);
});

test("3 — the exchange has no parameter that could substitute another organization", opts, async () => {
  // The strongest form of this guarantee is structural: `exchangeAuthCode` accepts only
  // code, verifier, clientId and redirectUri. There is nowhere to put a different org.
  const f = await fixture();
  await join(f.userId, f.orgA, "ACTIVE");
  await join(f.userId, f.orgB, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);

  assert.equal(exchangeAuthCode.length, 4, "exchangeAuthCode gained a parameter — check it is not an organization");
  const tokens = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.ok(tokens);
  assert.equal(claims(tokens.access_token)["org_id"], f.orgA, "the bound organization was not the one issued");
});

// ── 4-6. Revalidation between authorize and exchange ─────────────────────────

test("4 — membership revoked between authorize and exchange fails the exchange closed", opts, async () => {
  const f = await fixture();
  const m = await join(f.userId, f.orgA, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);

  await db.organizationMember.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });

  const tokens = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.equal(tokens, null, "a suspended membership still produced tokens");
});

test("5 — membership deleted between authorize and exchange fails the exchange closed", opts, async () => {
  const f = await fixture();
  const m = await join(f.userId, f.orgA, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);
  await db.organizationMember.delete({ where: { id: m.id } });

  assert.equal(await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT), null);
});

test("6 — an authorization code cannot be reused", opts, async () => {
  const f = await fixture();
  await join(f.userId, f.orgA, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);

  assert.ok(await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT), "first exchange should succeed");
  assert.equal(await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT), null, "the code was replayable");
});

// ── 7-8. Access and ID tokens agree ──────────────────────────────────────────

test("7 — access and ID tokens carry the same single org_id", opts, async () => {
  const f = await fixture();
  await join(f.userId, f.orgA, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);
  const tokens = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.ok(tokens?.id_token, "no id_token issued");

  const a = claims(tokens.access_token);
  const i = claims(tokens.id_token);
  assert.equal(a["org_id"], f.orgA);
  assert.equal(i["org_id"], f.orgA);
  assert.equal(a["org_id"], i["org_id"], "the two tokens disagreed about the active tenant");
  assert.equal(Array.isArray(a["organizations"]), false, "a membership array leaked into the token");
});

test("8 — only the selected organization's roles are emitted", opts, async () => {
  const f = await fixture();
  await join(f.userId, f.orgA, "ACTIVE", "MEMBER");
  await join(f.userId, f.orgB, "ACTIVE", "OWNER");
  const code = await mintCode(f, f.boundClient, f.orgA);
  const tokens = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.ok(tokens);
  assert.deepEqual(claims(tokens.access_token)["org_roles"], ["MEMBER"], "roles from another organization leaked");
});

// ── 9-12. Refresh preserves, revalidates, and refuses ────────────────────────

test("9 — refresh preserves the same organization", opts, async () => {
  const f = await fixture();
  await join(f.userId, f.orgA, "ACTIVE");
  await join(f.userId, f.orgB, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);
  const first = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.ok(first?.refresh_token);

  const rotated = await rotateRefreshToken(first.refresh_token, f.boundClient);
  assert.ok(rotated, "refresh failed");
  assert.equal(claims(rotated.access_token)["org_id"], f.orgA, "refresh changed the organization");
});

test("10 — a removed membership rejects refresh", opts, async () => {
  const f = await fixture();
  const m = await join(f.userId, f.orgA, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);
  const first = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.ok(first?.refresh_token);

  await db.organizationMember.delete({ where: { id: m.id } });
  assert.equal(await rotateRefreshToken(first.refresh_token, f.boundClient), null, "refresh survived removal");
});

test("11 — a suspended membership rejects refresh", opts, async () => {
  const f = await fixture();
  const m = await join(f.userId, f.orgA, "ACTIVE");
  const code = await mintCode(f, f.boundClient, f.orgA);
  const first = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.ok(first?.refresh_token);

  await db.organizationMember.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });
  assert.equal(await rotateRefreshToken(first.refresh_token, f.boundClient), null, "refresh survived suspension");
});

test("12 — refresh cannot switch organizations, even to one the user belongs to", opts, async () => {
  // The rotated token must stay on orgA while the user is also an active member of orgB.
  const f = await fixture();
  await join(f.userId, f.orgA, "ACTIVE");
  await join(f.userId, f.orgB, "ACTIVE", "OWNER");
  const code = await mintCode(f, f.boundClient, f.orgA);
  const first = await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT);
  assert.ok(first?.refresh_token);

  const rotated = await rotateRefreshToken(first.refresh_token, f.boundClient);
  assert.ok(rotated);
  assert.equal(claims(rotated.access_token)["org_id"], f.orgA);
  assert.notEqual(claims(rotated.access_token)["org_id"], f.orgB);
  assert.equal(rotateRefreshToken.length, 3, "rotateRefreshToken gained a parameter — check it is not an organization");
});

// ── 13-15. Legacy clients are untouched ──────────────────────────────────────

test("13 — a legacy client issues tokens with no organization claim", opts, async () => {
  const f = await fixture();
  // No memberships at all — a legacy client must not start requiring one.
  const code = await mintCode(f, f.legacyClient);
  const tokens = await exchangeAuthCode(code, VERIFIER, f.legacyClient, REDIRECT);
  assert.ok(tokens, "legacy client exchange broke");
  const a = claims(tokens.access_token);
  assert.equal(a["org_id"], undefined, "an organization claim appeared for an unmigrated client");
  assert.equal(a["org_roles"], undefined);
});

test("14 — a legacy code with organizationId=null still exchanges and refreshes", opts, async () => {
  const f = await fixture();
  const code = await mintCode(f, f.legacyClient);
  const row = await db.oAuthAuthorizationCode.findFirst({ where: { clientId: f.legacyClient }, orderBy: { createdAt: "desc" } });
  assert.equal(row?.organizationId, null, "the legacy code should carry no organization");

  const tokens = await exchangeAuthCode(code, VERIFIER, f.legacyClient, REDIRECT);
  assert.ok(tokens?.refresh_token, "legacy exchange failed");
  const rotated = await rotateRefreshToken(tokens.refresh_token, f.legacyClient);
  assert.ok(rotated, "legacy refresh failed with a null organization binding");
  assert.equal(claims(rotated.access_token)["org_id"], undefined);
});

test("15 — an organization-bound client with no eligible membership cannot exchange", opts, async () => {
  // Fails closed. The code should not have been issued, and even if one exists the
  // exchange refuses rather than minting a token with no tenant.
  const f = await fixture();
  await join(f.userId, f.orgA, "INVITED"); // an invitation is not membership
  const code = await mintCode(f, f.boundClient, f.orgA);
  assert.equal(await exchangeAuthCode(code, VERIFIER, f.boundClient, REDIRECT), null);

  // And the loader reports the invitation rather than hiding it, so the decision layer
  // can tell "not a member" apart from "membership not usable".
  const loaded = await loadMemberships(f.userId);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.status, "INVITED");
});
