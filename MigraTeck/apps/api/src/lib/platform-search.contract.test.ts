import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const route = repoFile("apps/api/src/routes/v1/modules/search.ts");
const model = repoFile("apps/api/src/lib/platform-search.ts");
const topBar = repoFile(
  "apps/web/src/components/platform/PlatformTopBar.tsx",
);
const trustPage = repoFile(
  "apps/web/src/app/(platform)/platform/trust/page.tsx",
);
const trustWorkspace = repoFile(
  "apps/web/src/components/platform/TrustOperationsWorkspace.tsx",
);

test("global live search requires authenticated platform-operator self authority", () => {
  assert.match(
    route,
    /requirePlatformAuthority\(request, \[\s*"platform\.self\.read"/,
  );
  assert.match(route, /q: z\.string\(\)\.trim\(\)\.min\(2\)\.max\(160\)/);
});

test("result families are independently permission-gated", () => {
  assert.match(
    model,
    /permissions\.has\("platform\.organizations\.read"\)/,
  );
  assert.match(model, /permissions\.has\("platform\.users\.read"\)/);
  assert.match(model, /permissions\.has\("platform\.commerce\.read"\)/);
  assert.match(model, /not_authorized/);
});

test("global search does not broaden OAuth client permission into API-key inventory", () => {
  assert.doesNotMatch(model, /FROM "ApiKey"/);
  assert.doesNotMatch(model, /secretHash|keyHash|prefixHint/);
  assert.doesNotMatch(model, /platform\.clients\.read/);
  assert.match(topBar, /title: "API Keys"/);
  assert.match(topBar, /href: "\/platform\/developers\/api-keys"/);
});

test("non-operators get module navigation without live cross-tenant requests", () => {
  assert.match(topBar, /operatorSearchEnabled = false/);
  assert.match(
    topBar,
    /if \(!operatorSearchEnabled \|\| trimmed\.length < 2\)/,
  );
  assert.match(topBar, /Cross-tenant entity search is available only to MigraTeck/);
});

test("identity-user search deep-links into Trust investigation rather than role grants", () => {
  assert.match(model, /href: target\("\/platform\/trust", query\)/);
  assert.doesNotMatch(model, /platform\/members/);
  assert.match(trustPage, /searchParams: Promise<\{ q\?: string \| string\[\] \}>/);
  assert.match(
    trustPage,
    /<TrustOperationsWorkspace initialQuery=\{initialQuery\} \/>/,
  );
  assert.match(
    trustWorkspace,
    /export function TrustOperationsWorkspace\(\{[\s\S]*?initialQuery = ""/,
  );
  assert.match(trustWorkspace, /const \[query, setQuery\] = useState\(initialQuery\)/);
});

test("search shortcuts and keyboard navigation are first-class controls", () => {
  assert.match(topBar, /event\.key === "\/"/);
  assert.match(topBar, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(topBar, /event\.key === "ArrowDown"/);
  assert.match(topBar, /event\.key === "ArrowUp"/);
  assert.match(topBar, /event\.key === "Enter"/);
  assert.match(topBar, /event\.key === "Escape"/);
});
