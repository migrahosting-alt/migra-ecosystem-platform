// MigraAuth — the active-organization binding rules.
//
// A membership array in a token does not say which tenant is authoritative for the
// request carrying it, so a token carries a singular `org_id` chosen at authorization,
// bound into the authorization code, and preserved through exchange and refresh.
//
// These tests cover the decisions rather than the plumbing: which organization a request
// may act in, when selection is required, and what happens when membership changes while
// a refresh token is still valid. They are pure — no database — because the rules are the
// security-relevant part and deserve exhaustive coverage that a Postgres fixture would
// discourage. © MigraTeck LLC.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeOrganizationClaims,
  decideActiveOrganization,
  revalidateActiveOrganization,
  type Membership,
} from "../src/modules/organizations/activeOrganization.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ORG_C = "33333333-3333-4333-8333-333333333333";

const member = (over: Partial<Membership> = {}): Membership => ({
  membershipId: "m-1",
  organizationId: ORG_A,
  status: "ACTIVE",
  roles: ["MEMBER"],
  ...over,
});

const REQUIRES = { clientRequiresActiveOrganization: true };

// ── 1-3. How many memberships decide the outcome ──────────────────────────────

test("1 — exactly one eligible membership binds automatically", () => {
  const d = decideActiveOrganization({ ...REQUIRES, memberships: [member()] });
  assert.ok(d.ok && d.active, JSON.stringify(d));
  assert.equal(d.active.orgId, ORG_A);
  assert.equal(d.active.orgMembershipId, "m-1");
});

test("2 — zero eligible memberships denies authorization with a structured reason", () => {
  // Denying is the point. A consumer client that requires a tenant must not fall back to
  // some implicit personal scope, which would be a tenant nobody administers.
  const none = decideActiveOrganization({ ...REQUIRES, memberships: [] });
  assert.equal(none.ok, false);
  assert.equal(none.ok === false && none.denial, "no_eligible_organization");

  // An invitation that was never accepted is not membership.
  const invitedOnly = decideActiveOrganization({ ...REQUIRES, memberships: [member({ status: "INVITED" })] });
  assert.equal(invitedOnly.ok, false);
  assert.equal(invitedOnly.ok === false && invitedOnly.denial, "no_eligible_organization");
});

test("3 — multiple eligible memberships require explicit selection", () => {
  const d = decideActiveOrganization({
    ...REQUIRES,
    memberships: [member(), member({ membershipId: "m-2", organizationId: ORG_B })],
  });
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.denial, "organization_selection_required");
  assert.deepEqual(d.ok === false && d.eligibleOrganizationIds, [ORG_A, ORG_B]);
});

// ── 4-5. A requested organization is a request, never authority ───────────────

test("4 — a user cannot select an organization they do not belong to", () => {
  const d = decideActiveOrganization({
    ...REQUIRES,
    memberships: [member(), member({ membershipId: "m-2", organizationId: ORG_B })],
    requestedOrganizationId: ORG_C,
  });
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.denial, "organization_not_permitted");
});

test("5 — an inactive membership cannot be selected", () => {
  for (const status of ["INVITED", "SUSPENDED", "REMOVED"] as const) {
    const d = decideActiveOrganization({
      ...REQUIRES,
      memberships: [member({ status })],
      requestedOrganizationId: ORG_A,
    });
    assert.equal(d.ok, false, `${status} was accepted`);
    assert.equal(d.ok === false && d.denial, "membership_inactive");
  }
});

test("6 — a valid selection among several is honoured", () => {
  const d = decideActiveOrganization({
    ...REQUIRES,
    memberships: [member(), member({ membershipId: "m-2", organizationId: ORG_B, roles: ["OWNER"] })],
    requestedOrganizationId: ORG_B,
  });
  assert.ok(d.ok && d.active);
  assert.equal(d.active.orgId, ORG_B);
  assert.deepEqual(d.active.orgRoles, ["OWNER"]);
});

// ── 7-8. Claims carry one organization and only its roles ────────────────────

test("7 — claims carry a single org_id, never a membership array", () => {
  const d = decideActiveOrganization({ ...REQUIRES, memberships: [member()] });
  assert.ok(d.ok && d.active);
  const claims = activeOrganizationClaims(d.active);
  assert.equal(typeof claims.org_id, "string");
  assert.equal(Array.isArray((claims as unknown as { organizations?: unknown }).organizations), false);
  assert.deepEqual(Object.keys(claims).sort(), ["org_id", "org_membership_id", "org_roles"]);
});

test("8 — only the selected organization's roles are emitted", () => {
  // An admin of one organization must not read as an admin of another.
  const d = decideActiveOrganization({
    ...REQUIRES,
    memberships: [
      member({ organizationId: ORG_A, roles: ["OWNER", "ADMIN"] }),
      member({ membershipId: "m-2", organizationId: ORG_B, roles: ["MEMBER"] }),
    ],
    requestedOrganizationId: ORG_B,
  });
  assert.ok(d.ok && d.active);
  assert.deepEqual(activeOrganizationClaims(d.active).org_roles, ["MEMBER"]);
});

// ── 9-12. Refresh revalidates rather than trusting the old binding ───────────

test("9 — refresh preserves the bound organization while membership holds", () => {
  const d = revalidateActiveOrganization({
    ...REQUIRES,
    boundOrganizationId: ORG_A,
    memberships: [member(), member({ membershipId: "m-2", organizationId: ORG_B })],
  });
  assert.ok(d.ok && d.active);
  assert.equal(d.active.orgId, ORG_A);
});

test("10 — a removed membership invalidates refresh", () => {
  const removed = revalidateActiveOrganization({ ...REQUIRES, boundOrganizationId: ORG_A, memberships: [] });
  assert.equal(removed.ok, false);
  assert.equal(removed.ok === false && removed.denial, "organization_not_permitted");
});

test("11 — a disabled membership invalidates refresh", () => {
  for (const status of ["SUSPENDED", "REMOVED", "INVITED"] as const) {
    const d = revalidateActiveOrganization({ ...REQUIRES, boundOrganizationId: ORG_A, memberships: [member({ status })] });
    assert.equal(d.ok, false, `${status} still refreshed`);
    assert.equal(d.ok === false && d.denial, "membership_inactive");
  }
});

test("12 — refresh never silently switches to another organization", () => {
  // The dangerous failure is not an error. Quietly moving the user to an organization
  // they still belong to would hand them a tenant they never authorized, and would make
  // every audit record from that point name the wrong one.
  const d = revalidateActiveOrganization({
    ...REQUIRES,
    boundOrganizationId: ORG_A,
    memberships: [member({ membershipId: "m-2", organizationId: ORG_B })],
  });
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.denial, "organization_not_permitted");
});

test("13 — a client requiring an organization cannot acquire one at refresh time", () => {
  // The binding is made where the user consented to it, not later.
  const d = revalidateActiveOrganization({ ...REQUIRES, boundOrganizationId: undefined, memberships: [member()] });
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.denial, "no_eligible_organization");
});

// ── 14-15. Existing clients are untouched until migrated ─────────────────────

test("14 — clients that do not require an organization are unaffected", () => {
  // Portal clients keep working exactly as before. Making the claim mandatory for every
  // existing client in the same change would break the portal to serve a consumer app
  // that is not deployed yet.
  const authorize = decideActiveOrganization({
    clientRequiresActiveOrganization: false,
    memberships: [],
  });
  assert.ok(authorize.ok);
  assert.equal(authorize.active, undefined);

  const refresh = revalidateActiveOrganization({
    clientRequiresActiveOrganization: false,
    boundOrganizationId: undefined,
    memberships: [],
  });
  assert.ok(refresh.ok);
  assert.equal(refresh.active, undefined);
});

test("15 — an unmigrated client is unaffected even by a stale bound organization", () => {
  const d = revalidateActiveOrganization({
    clientRequiresActiveOrganization: false,
    boundOrganizationId: ORG_C,
    memberships: [],
  });
  assert.ok(d.ok, "an unmigrated client must not start failing because of an old binding");
  assert.equal(d.active, undefined);
});

// ── 16. Switching organizations is a new authorization, not a token request ──

test("16 — switching organizations requires a fresh decision, not a refresh", () => {
  // Refresh can only ever preserve or refuse. There is no input to it that changes the
  // organization, which is what makes "switch by sending a header" impossible.
  const refreshed = revalidateActiveOrganization({
    ...REQUIRES,
    boundOrganizationId: ORG_A,
    memberships: [member(), member({ membershipId: "m-2", organizationId: ORG_B })],
  });
  assert.ok(refreshed.ok && refreshed.active);
  assert.equal(refreshed.active.orgId, ORG_A, "refresh must not honour a different organization");

  // Only a new authorization, with an explicit selection, moves the user.
  const reauthorized = decideActiveOrganization({
    ...REQUIRES,
    memberships: [member(), member({ membershipId: "m-2", organizationId: ORG_B })],
    requestedOrganizationId: ORG_B,
  });
  assert.ok(reauthorized.ok && reauthorized.active);
  assert.equal(reauthorized.active.orgId, ORG_B);
});
