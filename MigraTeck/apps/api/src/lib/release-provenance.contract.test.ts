import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getReleaseIntegritySnapshot,
  hashReleaseTree,
} from "./release-provenance.js";

async function createManifest(input: {
  service: string;
  sourceRoot: string;
  artifactRoot: string;
  output: string;
}) {
  const sourceSha256 = await hashReleaseTree(input.sourceRoot);
  const artifactSha256 = await hashReleaseTree(input.artifactRoot);

  const manifest = {
    schemaVersion: 1,
    kind: "build",
    service: input.service,
    commit: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    builtAt: "2026-10-08T10:00:00.000Z",
    sourceRoot: input.service === "api" ? "../src" : "../src",
    artifactRoot: input.service === "api" ? "." : "server",
    sourceSha256,
    artifactSha256,
  };

  await writeFile(input.output, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

test("release provenance verifies source and compiled output, detects drift, and rejects path escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "migrateck-release-integrity-"));
  const apiRoot = join(root, "api");
  const webRoot = join(root, "web");
  const apiSource = join(apiRoot, "src");
  const apiDist = join(apiRoot, "dist");
  const webSource = join(webRoot, "src");
  const webServer = join(webRoot, ".next", "server");
  const apiManifest = join(apiDist, "release-manifest.json");
  const webManifest = join(webRoot, ".next", "release-manifest.json");

  try {
    await Promise.all([
      mkdir(apiSource, { recursive: true }),
      mkdir(apiDist, { recursive: true }),
      mkdir(webSource, { recursive: true }),
      mkdir(webServer, { recursive: true }),
    ]);

    await Promise.all([
      writeFile(join(apiSource, "server.ts"), "export const version = 1;\n"),
      writeFile(join(apiDist, "server.js"), "export const version = 1;\n"),
      writeFile(join(webSource, "page.tsx"), "export default function Page() {}\n"),
      writeFile(join(webServer, "app.js"), "export default function Page() {}\n"),
    ]);

    await createManifest({
      service: "api",
      sourceRoot: apiSource,
      artifactRoot: apiDist,
      output: apiManifest,
    });
    await createManifest({
      service: "web",
      sourceRoot: webSource,
      artifactRoot: webServer,
      output: webManifest,
    });

    const previous = {
      apiRoot: process.env.MIGRATECK_PLATFORM_API_ROOT,
      apiManifest: process.env.MIGRATECK_PLATFORM_API_RELEASE_MANIFEST,
      webRoot: process.env.MIGRATECK_WEB_RELEASE_ROOT,
      webManifest: process.env.MIGRATECK_WEB_RELEASE_MANIFEST,
    };

    process.env.MIGRATECK_PLATFORM_API_ROOT = apiRoot;
    process.env.MIGRATECK_PLATFORM_API_RELEASE_MANIFEST = apiManifest;
    process.env.MIGRATECK_WEB_RELEASE_ROOT = webRoot;
    process.env.MIGRATECK_WEB_RELEASE_MANIFEST = webManifest;

    try {
      const verified = await getReleaseIntegritySnapshot(true);
      assert.deepEqual(
        verified.map((release) => [release.key, release.state]),
        [
          ["platform_api", "verified"],
          ["platform_web", "verified"],
        ],
      );

      await writeFile(join(apiDist, "server.js"), "export const version = 2;\n");
      const drifted = await getReleaseIntegritySnapshot(true);
      const api = drifted.find((release) => release.key === "platform_api");
      assert.equal(api?.state, "drift");
      assert.equal(api?.sourceMatches, true);
      assert.equal(api?.artifactMatches, false);

      const raw = JSON.parse(await readFile(webManifest, "utf8")) as Record<string, unknown>;
      raw.sourceRoot = "../../../";
      await writeFile(webManifest, JSON.stringify(raw, null, 2) + "\n");

      const escaped = await getReleaseIntegritySnapshot(true);
      const web = escaped.find((release) => release.key === "platform_web");
      assert.equal(web?.state, "invalid");
      assert.match(web?.detail ?? "", /escaped the allowed service directory/i);
    } finally {
      if (previous.apiRoot === undefined) delete process.env.MIGRATECK_PLATFORM_API_ROOT;
      else process.env.MIGRATECK_PLATFORM_API_ROOT = previous.apiRoot;
      if (previous.apiManifest === undefined) delete process.env.MIGRATECK_PLATFORM_API_RELEASE_MANIFEST;
      else process.env.MIGRATECK_PLATFORM_API_RELEASE_MANIFEST = previous.apiManifest;
      if (previous.webRoot === undefined) delete process.env.MIGRATECK_WEB_RELEASE_ROOT;
      else process.env.MIGRATECK_WEB_RELEASE_ROOT = previous.webRoot;
      if (previous.webManifest === undefined) delete process.env.MIGRATECK_WEB_RELEASE_MANIFEST;
      else process.env.MIGRATECK_WEB_RELEASE_MANIFEST = previous.webManifest;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
