import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");
const organizations = src("routes/organizations.ts");
const users = src("modules/users/index.ts");
const auth = src("routes/auth.ts");

test("organization invitations create a pending identity without a password credential", () => {
  const at = users.indexOf("export async function createInvitedUser");
  assert.ok(at > 0, "createInvitedUser must exist");
  const body = users.slice(at, at + 1200);

  assert.match(body, /status:\s*"PENDING"/);
  assert.match(body, /userIdentifier\.create/);
  assert.doesNotMatch(body, /credentials:\s*\{/);
  assert.doesNotMatch(body, /secretHash/);
});

test("normal sign-in refuses pending invited identities", () => {
  assert.match(
    auth,
    /if \(!identifier\.isVerified \|\| user\.status === "PENDING"\)/,
  );
});

test("only active organization OWNER or ADMIN may invite and resend", () => {
  const addAt = organizations.indexOf(
    'app.post("/v1/organizations/:org_id/members"',
  );
  const addBody = organizations.slice(addAt, addAt + 3600);
  assert.match(addBody, /status:\s*"ACTIVE"/);
  assert.match(addBody, /role:\s*\{ in: \["OWNER", "ADMIN"\] \}/);
  assert.match(addBody, /identifier\.kind !== "EMAIL"/);
  assert.match(addBody, /createInvitedUser/);

  const resendAt = organizations.indexOf(
    '"/v1/organizations/:org_id/members/:member_id/resend-invite"',
  );
  const resendBody = organizations.slice(resendAt, resendAt + 3000);
  assert.match(resendBody, /status:\s*"ACTIVE"/);
  assert.match(resendBody, /role:\s*\{ in: \["OWNER", "ADMIN"\] \}/);
  assert.match(resendBody, /member\.user\.status !== "PENDING"/);
});

test("resending invalidates older setup links before issuing a replacement", () => {
  const at = organizations.indexOf("async function deliverOrganizationInvite");
  const body = organizations.slice(at, at + 2200);
  assert.match(body, /passwordReset\.updateMany/);
  assert.match(body, /status:\s*"REVOKED"/);
  assert.match(body, /createPasswordResetToken/);
  assert.match(body, /sendInternalInviteEmail/);
});

test("organization membership operations never grant platform roles", () => {
  assert.doesNotMatch(organizations, /grantRole\(/);
  assert.doesNotMatch(organizations, /platformRoleGrant/);
  assert.match(
    organizations,
    /role:\s*body\.role\.toUpperCase\(\) as "ADMIN" \| "BILLING_ADMIN" \| "MEMBER"/,
  );
});

test("organization OWNER membership cannot be reassigned or removed here", () => {
  assert.match(
    organizations,
    /Organization ownership cannot be reassigned here\./,
  );
  assert.match(
    organizations,
    /Organization ownership cannot be removed here\./,
  );
});

test("invite delivery failure remains audited and the identity stays pending", () => {
  assert.match(organizations, /ORG_MEMBER_INVITE_DELIVERY_FAILED/);
  assert.match(organizations, /pending identity remains unable to sign in/);
  assert.match(organizations, /ORG_MEMBER_INVITED/);
});
