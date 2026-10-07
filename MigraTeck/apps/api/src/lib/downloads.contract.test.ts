import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  downloadAccessReason,
  isClientOnlyDownloadProduct,
  isDownloadEntitlementAllowed,
  isInternalDownloadOrganization,
} from "./downloads.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

test("download entitlement runtime honors status and time windows", () => {
  const now = new Date("2026-10-06T20:00:00.000Z");

  assert.equal(
    isDownloadEntitlementAllowed({
      status: "ACTIVE",
      now,
      isInternalOrg: false,
    }),
    true,
  );
  assert.equal(
    isDownloadEntitlementAllowed({
      status: "TRIAL",
      startsAt: new Date("2026-10-01T00:00:00.000Z"),
      endsAt: new Date("2026-10-20T00:00:00.000Z"),
      now,
      isInternalOrg: false,
    }),
    true,
  );
  assert.equal(
    isDownloadEntitlementAllowed({
      status: "TRIAL",
      startsAt: new Date("2026-10-07T00:00:00.000Z"),
      now,
      isInternalOrg: false,
    }),
    false,
  );
  assert.equal(
    isDownloadEntitlementAllowed({
      status: "ACTIVE",
      endsAt: new Date("2026-10-06T19:00:00.000Z"),
      now,
      isInternalOrg: false,
    }),
    false,
  );
  assert.equal(
    isDownloadEntitlementAllowed({
      status: "RESTRICTED",
      now,
      isInternalOrg: true,
    }),
    false,
  );
});

test("internal-only artifacts require an internal Migra organization", () => {
  assert.equal(isInternalDownloadOrganization("migrateck"), true);
  assert.equal(isInternalDownloadOrganization("MigraHosting-ops"), true);
  assert.equal(isInternalDownloadOrganization("customer-acme"), false);

  assert.equal(
    isDownloadEntitlementAllowed({
      status: "INTERNAL_ONLY",
      isInternalOrg: true,
    }),
    true,
  );
  assert.equal(
    isDownloadEntitlementAllowed({
      status: "INTERNAL_ONLY",
      isInternalOrg: false,
    }),
    false,
  );
});

test("client-only download products stay closed outside client/owner rules", () => {
  assert.equal(isClientOnlyDownloadProduct("MIGRAHOSTING"), true);
  assert.equal(isClientOnlyDownloadProduct("MIGRAPANEL"), true);
  assert.equal(isClientOnlyDownloadProduct("MIGRAINVOICE"), false);

  assert.equal(
    downloadAccessReason({
      entitled: true,
      clientAllowed: false,
      status: "ACTIVE",
    }),
    "CLIENT_ONLY_PRODUCT",
  );
});

test("downloads route accepts all active organization membership roles", () => {
  const routes = repoFile("apps/api/src/routes/v1/modules/downloads.ts");
  for (const role of ["OWNER", "ADMIN", "BILLING_ADMIN", "MEMBER"]) {
    assert.match(routes, new RegExp('"' + role + '"'));
  }
  assert.match(routes, /requireOrganizationPrincipal/);
  assert.match(routes, /\/downloads\/:artifactId\/sign/);
});

test("download listing never exposes storage object keys or storage credentials", () => {
  const source = repoFile("apps/api/src/lib/downloads.ts");
  const listingStart = source.indexOf("export async function listDownloadArtifacts");
  const signingStart = source.indexOf("export async function signDownloadArtifact");
  const listing = source.slice(listingStart, signingStart);

  assert.ok(listingStart >= 0 && signingStart > listingStart);
  assert.doesNotMatch(listing, /fileKey:\s*artifact\.fileKey/);
  assert.doesNotMatch(listing, /secretAccessKey/);
  assert.doesNotMatch(listing, /accessKeyId/);
});

test("download signing fails closed in production and is rate limited and audited", () => {
  const source = repoFile("apps/api/src/lib/downloads.ts");

  assert.match(source, /Mock download signing is disabled in production/);
  assert.match(source, /Download storage signer is incomplete/);
  assert.match(source, /DOWNLOAD_SIGN_RATE_LIMIT_PER_HOUR/);
  assert.match(source, /DOWNLOAD_SIGNED_URL_DENIED/);
  assert.match(source, /DOWNLOAD_SIGNED_URL_ISSUED/);
  assert.match(source, /ResponseContentDisposition/);
});

test("obsolete prepared auth session route is no longer registered", () => {
  const registry = repoFile("apps/api/src/routes/v1/index.ts");
  assert.doesNotMatch(registry, /registerAuthRoutes/);

  const authStub = repoFile("apps/api/src/routes/v1/modules/auth.ts");
  assert.match(authStub, /status:\s*"prepared"/);
  assert.match(authStub, /future-argon2id-session-isolation/);
});
