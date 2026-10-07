import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { readLegacyIntakeFiles } from "./intake-integration.js";

test("legacy Intake adapter returns sanitized operational metadata only", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "migraintake-contract-"));
  try {
    await fs.mkdir(path.join(root, "data", "intakes"), { recursive: true });
    await fs.mkdir(path.join(root, "uploads"), { recursive: true });
    await fs.mkdir(path.join(root, "backups"), { recursive: true });

    await fs.writeFile(
      path.join(root, "data", "projects.json"),
      JSON.stringify([
        {
          id: "project-1",
          name: "Website intake",
          status: "active",
          type: "website",
          tier: "business",
          submissionsCount: 2,
          leadScore: 91,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
          lastActivity: "2026-10-03T00:00:00.000Z",
          publicToken: "must-not-leak",
          contactEmail: "must-not-leak@example.com",
        },
      ]),
    );

    await fs.writeFile(
      path.join(root, "data", "intakes", "submission-1.json"),
      JSON.stringify({
        answers: { secret: "customer answer" },
        files: { passport: [{ path: "/private/file" }] },
        meta: { projectId: "project-1" },
      }),
    );
    await fs.writeFile(
      path.join(root, "data", "intakes", "submission-2.json"),
      JSON.stringify({ answers: { secret: "another answer" } }),
    );
    await fs.writeFile(path.join(root, "uploads", "asset.bin"), Buffer.alloc(32));
    await fs.writeFile(path.join(root, "backups", "backup.tgz"), Buffer.alloc(16));

    const snapshot = await readLegacyIntakeFiles(root);

    assert.equal(snapshot.counts.projects, 1);
    assert.equal(snapshot.counts.submissions, 2);
    assert.equal(snapshot.counts.uploads, 1);
    assert.equal(snapshot.counts.backups, 1);
    assert.equal(snapshot.projects[0]?.id, "project-1");
    assert.equal(snapshot.projects[0]?.leadScore, 91);
    assert.equal(snapshot.projectStatus.active, 1);
    assert.equal(snapshot.projectTier.business, 1);

    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes("must-not-leak"), false);
    assert.equal(serialized.includes("customer answer"), false);
    assert.equal(serialized.includes("/private/file"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("legacy Intake adapter fails soft when optional runtime files are absent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "migraintake-empty-"));
  try {
    const snapshot = await readLegacyIntakeFiles(root);
    assert.deepEqual(snapshot.projects, []);
    assert.equal(snapshot.counts.projects, 0);
    assert.equal(snapshot.counts.submissions, 0);
    assert.equal(snapshot.counts.uploads, 0);
    assert.equal(snapshot.backups.latestAt, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("legacy Intake runtime bridge is global platform authority and read-only", () => {
  const routePath = new URL(
    "../routes/v1/modules/intake.ts",
    import.meta.url,
  );
  const source = readFileSync(routePath, "utf8");
  const legacyStart = source.indexOf('app.get("/intake/runtime"');
  const nativeStart = source.indexOf('app.get("/intake/native/status"');

  assert.ok(legacyStart >= 0, "legacy runtime route is missing");
  assert.ok(nativeStart > legacyStart, "tenant-native routes must remain separate");
  const legacyBridge = source.slice(legacyStart, nativeStart);

  assert.match(legacyBridge, /requirePlatformAuthority/);
  assert.match(legacyBridge, /platform\.intake\.read/);
  assert.doesNotMatch(legacyBridge, /app\.(post|put|patch|delete)\(/);
  assert.doesNotMatch(legacyBridge, /requireOrganizationPrincipal/);

  // Tenant-native Intake intentionally owns audited form/submission mutations.
  assert.match(source.slice(nativeStart), /app\.post\("\/intake\/native\/organizations\/:orgId\/forms"/);
  assert.match(source.slice(nativeStart), /app\.patch\("\/intake\/native\/forms\/:formId"/);
});
