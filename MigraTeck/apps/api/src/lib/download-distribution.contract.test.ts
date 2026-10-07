import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeDownloadFileKey } from "./download-distribution.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

test("release object keys are normalized and traversal-safe", () => {
  assert.equal(
    normalizeDownloadFileKey("migrainvoice/1.0.0/MigraInvoice.exe"),
    "migrainvoice/1.0.0/MigraInvoice.exe",
  );

  for (const invalid of [
    "",
    "/absolute/file.exe",
    "../escape.exe",
    "migrainvoice/../escape.exe",
    "migrainvoice//file.exe",
    "migrainvoice\\file.exe",
    "migrainvoice/./file.exe",
    "migrainvoice/file.exe\nother",
  ]) {
    assert.throws(() => normalizeDownloadFileKey(invalid), invalid);
  }
});

test("distribution routes require platform authority instead of organization membership", () => {
  const routes = repoFile("apps/api/src/routes/v1/modules/distribution.ts");
  assert.match(routes, /requirePlatformAuthority/);
  assert.doesNotMatch(routes, /requireOrganizationPrincipal/);
  assert.match(routes, /platform\.downloads\.read/);
  assert.match(routes, /platform\.downloads\.verify/);
  assert.match(routes, /platform\.downloads\.manage/);
});

test("release registration derives integrity metadata and starts inactive", () => {
  const source = repoFile("apps/api/src/lib/download-distribution.ts");
  assert.match(source, /const verified = await streamObjectIntegrity\(fileKey\)/);
  assert.match(
    source,
    /INSERT INTO "DownloadArtifact"[\s\S]*verified\.sha256[\s\S]*verified\.sizeBytes/,
  );
  assert.match(source, /VALUES \([^;]*false,NOW\(\)\)/);
  assert.match(source, /DOWNLOAD_ARTIFACT_REGISTERED/);
});

test("activation re-verifies bytes and fails closed on checksum or size drift", () => {
  const source = repoFile("apps/api/src/lib/download-distribution.ts");
  const start = source.indexOf("export async function activateDistributionArtifact");
  const end = source.indexOf("export async function deactivateDistributionArtifact");
  const activation = source.slice(start, end);

  assert.match(activation, /streamObjectIntegrity\(before\.fileKey\)/);
  assert.match(activation, /actual\.sizeBytes !== before\.sizeBytes/);
  assert.match(activation, /actual\.sha256 !== before\.sha256/);
  assert.match(activation, /DOWNLOAD_ARTIFACT_ACTIVATION_BLOCKED/);
  assert.match(activation, /DOWNLOAD_ARTIFACT_ACTIVATED/);
});

test("distribution management preserves history instead of hard deleting artifacts", () => {
  const routes = repoFile("apps/api/src/routes/v1/modules/distribution.ts");
  const source = repoFile("apps/api/src/lib/download-distribution.ts");

  assert.doesNotMatch(routes, /app\.delete\(/);
  assert.doesNotMatch(source, /DELETE FROM "DownloadArtifact"/);
  assert.match(source, /UPDATE "DownloadArtifact" SET "isActive"=false/);
  assert.match(source, /DOWNLOAD_ARTIFACT_DEACTIVATED/);
});

test("customer signing and operator verification share one signer configuration contract", () => {
  const customer = repoFile("apps/api/src/lib/downloads.ts");
  const operator = repoFile("apps/api/src/lib/download-distribution.ts");

  assert.match(customer, /export function getDownloadSignerConfig/);
  assert.match(customer, /const config = getDownloadSignerConfig\(\)/);
  assert.match(operator, /getDownloadSignerConfig/);
});
