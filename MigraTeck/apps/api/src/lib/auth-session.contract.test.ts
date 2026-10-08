import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const authRoute = repoFile("apps/api/src/routes/v1/modules/auth.ts");
const routeIndex = repoFile("apps/api/src/routes/v1/index.ts");
const authority = repoFile("apps/api/src/lib/migraauth.ts");

test("Platform auth session is a registered live route, not a prepared stub", () => {
  assert.match(authRoute, /app\.get\("\/auth\/session"/);
  assert.match(authRoute, /getPlatformIdentityDiagnostic/);
  assert.doesNotMatch(authRoute, /status:\s*"prepared"/);
  assert.doesNotMatch(authRoute, /future-argon2id-session-isolation/);
  assert.match(routeIndex, /registerAuthRoutes/);
  assert.match(routeIndex, /await registerAuthRoutes\(instance\)/);
});

test("identity diagnostic reads MigraAuth identity and membership authority", () => {
  assert.match(
    authority,
    /authFetch<MeResponse>\("\/v1\/me", token\)/,
  );
  assert.match(
    authority,
    /authFetch<OrganizationsResponse>\("\/v1\/organizations", token\)/,
  );
  assert.match(authority, /authFetchPlatformAuthority\(token\)/);
  assert.match(authority, /platformOperator:/);
});

test("requested organization must belong to the authenticated identity", () => {
  assert.match(
    authority,
    /organizations\.organizations\.find\(\(membership\) => membership\.id === requested\)/,
  );
  assert.match(
    authority,
    /Requested organization is not part of this authenticated identity/,
  );
});

test("diagnostic observes bridge state without bootstrapping local rows", () => {
  const start = authority.indexOf("export async function getPlatformIdentityDiagnostic");
  const end = authority.indexOf("async function ensurePlatformUser", start);
  assert.ok(start >= 0 && end > start);
  const diagnostic = authority.slice(start, end);

  assert.match(diagnostic, /"authUserId"/);
  assert.match(diagnostic, /"authOrganizationId"/);
  assert.match(diagnostic, /email_candidate/);
  assert.match(diagnostic, /slug_candidate/);
  assert.doesNotMatch(diagnostic, /INSERT INTO/);
  assert.doesNotMatch(diagnostic, /UPDATE "User"/);
  assert.doesNotMatch(diagnostic, /UPDATE "Organization"/);
});

test("diagnostic response never returns bearer or refresh token material", () => {
  const start = authority.indexOf("export async function getPlatformIdentityDiagnostic");
  const end = authority.indexOf("async function ensurePlatformUser", start);
  const diagnostic = authority.slice(start, end);

  assert.doesNotMatch(diagnostic, /accessToken|refreshToken|bearerToken:\s*token/);
  assert.match(diagnostic, /strategy:\s*"migraauth-oauth2-bearer"/);
});

test("Platform Overview consumes identity bridge health fail-closed", () => {
  const overview = repoFile(
    "apps/web/src/app/(platform)/platform/overview/page.tsx",
  );

  assert.match(overview, /fetchPlatformAuthorityApi<IdentityDiagnostic>/);
  assert.match(overview, /"\/auth\/session"/);
  assert.match(overview, /identityBridgeHealthy/);
  assert.match(overview, /Identity bridge diagnostic unavailable/);
  assert.match(overview, /Identity bridge needs reconciliation/);
  assert.match(
    overview,
    /!identityResult\.ok \|\| !sessionsResult\.ok \|\| !auditResult\.ok/,
  );
});
