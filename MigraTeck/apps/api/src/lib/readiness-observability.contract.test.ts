import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

test("platform readiness failures are logged without exposing dependency errors in the response", () => {
  const source = repoFile("apps/api/src/app.ts");

  assert.match(source, /catch \(error\)/);
  assert.match(source, /logError\("api\.readiness_failed"/);
  assert.match(source, /Unknown readiness dependency failure/);

  const readyHandler = source.match(
    /app\.get\("\/ready"[\s\S]*?await registerV1Routes\(app\);/,
  )?.[0];

  assert.ok(readyHandler, "ready handler should be present");
  assert.match(readyHandler, /reply\.code\(503\)\.send\(\{[\s\S]*?status: "not_ready"/);
  assert.doesNotMatch(
    readyHandler,
    /reply\.code\(503\)[\s\S]*?error instanceof Error \? error\.message/,
    "the readiness response must not disclose dependency error messages",
  );
});
