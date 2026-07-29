import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { allNavHrefs, NAV, visibleNav, type NavCapability } from "./nav-model.ts";

/**
 * Navigation authorization and integrity.
 *
 * Sidebar visibility is CONVENIENCE, never enforcement. These tests assert both halves of
 * that sentence: a viewer without a capability does not see the entry, AND the destination
 * still refuses them if they type the URL. A test suite that only checked the first half
 * would pass on a build where hiding had quietly become the only protection.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSOLE_ROOT = join(HERE, "..");
const APP_ROOT = join(CONSOLE_ROOT, "..");

const NONE: ReadonlySet<NavCapability> = new Set();
const ALL: ReadonlySet<NavCapability> = new Set<NavCapability>([
  "pale.accounts.read",
  "pale.reports.read",
]);

const hrefsOf = (items: ReturnType<typeof visibleNav>): string[] =>
  items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]);

// ── visibility ───────────────────────────────────────────────────────────────

test("a viewer with NO capabilities sees neither Pale Accounts nor Pale Reports", () => {
  const visible = hrefsOf(visibleNav(NONE));
  assert.ok(!visible.includes("/console/pale/users"), "Accounts must be hidden");
  assert.ok(!visible.includes("/console/pale/reports"), "Reports must be hidden");
});

test("each capability reveals ONLY its own entry", () => {
  const accounts = hrefsOf(visibleNav(new Set<NavCapability>(["pale.accounts.read"])));
  assert.ok(accounts.includes("/console/pale/users"));
  assert.ok(!accounts.includes("/console/pale/reports"), "accounts capability must not reveal reports");

  const reports = hrefsOf(visibleNav(new Set<NavCapability>(["pale.reports.read"])));
  assert.ok(reports.includes("/console/pale/reports"));
  assert.ok(!reports.includes("/console/pale/users"), "reports capability must not reveal accounts");
});

test("a hidden entry leaks neither its href nor its label", () => {
  // Filtering must remove the node, not merely skip rendering it — a retained object could
  // still reach the client as serialized props.
  const serialized = JSON.stringify(visibleNav(NONE));
  assert.ok(!serialized.includes("/console/pale/users"));
  assert.ok(!serialized.includes("/console/pale/reports"));
});

test("a parent stays visible when all of its children are filtered away", () => {
  // The parent is its own destination, not just a container: /console/pale is a real page
  // that a viewer without account/report access may still open.
  const pale = visibleNav(NONE).find((i) => i.href === "/console/pale");
  assert.ok(pale, "the Pale entry must survive");
  assert.deepEqual(pale!.children, [], "…with no children");
});

test("ungated entries are visible to every authenticated viewer", () => {
  const visible = hrefsOf(visibleNav(NONE));
  for (const href of ["/console", "/console/clients", "/console/annoupale"]) {
    assert.ok(visible.includes(href), `${href} must not require a capability`);
  }
  // The eight AnnouPale routes are session-gated only, matching what their pages enforce.
  for (const child of NAV.find((i) => i.href === "/console/annoupale")!.children ?? []) {
    assert.equal(child.capability, undefined, `${child.href} must not claim a capability it does not enforce`);
    assert.ok(visible.includes(child.href));
  }
});

// ── the rule that matters most ───────────────────────────────────────────────

test("NO capability grants blanket access — every gate is enumerated", () => {
  // Guards against the shape that later grows a bypass: a wildcard, an isAdmin, a role that
  // implies everything.
  const source = readFileSync(join(HERE, "nav-model.ts"), "utf8");
  for (const banned of ["isAdmin", "*", "superuser", "ALL_CAPABILITIES"]) {
    assert.ok(!source.includes(`"${banned}"`), `nav-model must not use a ${banned} shortcut`);
  }
  const caps = new Set(
    NAV.flatMap((i) => [i.capability, ...(i.children ?? []).map((c) => c.capability)]).filter(Boolean),
  );
  assert.deepEqual([...caps].sort(), ["pale.accounts.read", "pale.reports.read"]);
});

test("HIDING IS NOT ENFORCEMENT — every gated destination denies server-side too", () => {
  /**
   * The critical test. For each capability-gated nav entry, the page it points at must
   * perform its own authorization check and redirect. If someone later removes a page's
   * guard because "the link is hidden anyway", this fails.
   */
  const GUARDED: Array<[string, string, string]> = [
    ["/console/pale/users", "pale/users/page.tsx", "canViewAccounts"],
    ["/console/pale/reports", "pale/reports/page.tsx", "canViewReports"],
  ];
  for (const [href, file, guard] of GUARDED) {
    const src = readFileSync(join(CONSOLE_ROOT, file), "utf8");
    assert.match(src, /getSession\(\)/, `${href}: must require a session`);
    assert.match(src, new RegExp(guard), `${href}: must call ${guard} server-side`);
    assert.match(src, /redirect\(/, `${href}: must redirect when unauthorized`);
  }
});

test("dynamic detail routes enforce authorization independently of their parent", () => {
  // A detail page reached by URL must not rely on the list page having checked first.
  for (const [file, guard] of [
    ["pale/users/[id]/page.tsx", "canViewAccounts"],
    ["pale/reports/[id]/page.tsx", "canViewReports"],
    ["pale/reports/activity/page.tsx", "canViewReports"],
  ] as const) {
    const src = readFileSync(join(CONSOLE_ROOT, file), "utf8");
    assert.match(src, new RegExp(guard), `${file} must check ${guard} itself`);
    assert.match(src, /redirect\(/, `${file} must redirect when unauthorized`);
  }
});

// ── registry integrity ───────────────────────────────────────────────────────

test("every nav href resolves to a real page — no dead entries", () => {
  for (const href of allNavHrefs()) {
    const page = join(APP_ROOT, href.replace(/^\/console/, "console"), "page.tsx");
    assert.ok(statSync(page).isFile(), `${href} has no page.tsx`);
  }
});

test("no duplicate hrefs, and no dynamic segment in the sidebar", () => {
  const hrefs = allNavHrefs();
  assert.equal(new Set(hrefs).size, hrefs.length, "duplicate nav entries");
  for (const h of hrefs) {
    assert.ok(!h.includes("["), `${h}: dynamic routes belong on their parent surface, not the sidebar`);
  }
});

test("the removed mail module has no navigation entry", () => {
  assert.ok(!allNavHrefs().some((h) => h.startsWith("/console/mail")));
});

test("there is exactly ONE nav registry — the orphaned duplicate is gone", () => {
  // nav-items.ts was a second registry behind an orphaned MobileNav, already drifted from
  // canonical. Two registries drift; this asserts we are back to one.
  const files = readdirSync(HERE);
  assert.ok(!files.includes("nav-items.ts"), "the duplicate registry must stay deleted");
  assert.ok(!files.includes("MobileNav.tsx"), "its orphaned renderer must stay deleted");
  assert.ok(files.includes("nav-model.ts"));
});

test("Sidebar.tsx is the only renderer of the registry", () => {
  const importers: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === ".next") continue;
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) {
        if (/from "\.[^"]*nav-model"/.test(readFileSync(f, "utf8"))) importers.push(relative(CONSOLE_ROOT, f));
      }
    }
  };
  walk(APP_ROOT);
  assert.deepEqual(importers, ["components/Sidebar.tsx"]);
});
