/**
 * Canonical integration gate.
 *
 * Produces ONE stable check context (`canonical-integration-gate`) that always runs on every pull
 * request targeting the integration branch, whatever paths changed. Branch protection requires
 * this single context instead of naively requiring path-filtered jobs — which would leave any PR
 * outside those paths waiting forever on a check that was never emitted.
 *
 * The underlying gates live in separate workflow files, so `needs:` cannot see them. This reads
 * the Checks API for the PR head SHA instead.
 *
 * Decision rules live in ./lib/gate-rules.mjs and are unit-tested; this file is I/O only.
 * No `continue-on-error` anywhere: a non-zero exit here is the gate verdict.
 */

import {
  GATE_CONTEXT,
  computeApplicability,
  evaluate,
  pendingContexts,
} from "./lib/gate-rules.mjs";

const TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const PR_NUMBER = process.env.PR_NUMBER;
const HEAD_SHA = process.env.HEAD_SHA;

const WAIT_BUDGET_MS = Number(process.env.GATE_WAIT_BUDGET_MS ?? 20 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.GATE_POLL_INTERVAL_MS ?? 15_000);

function fail(message) {
  console.error(`\n::error::${message}`);
  process.exit(1);
}

if (!TOKEN || !REPO || !PR_NUMBER || !HEAD_SHA) {
  fail("missing required environment: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, HEAD_SHA");
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": GATE_CONTEXT,
    },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function changedFiles() {
  const files = [];
  const MAX_PAGES = 30; // 3000 files
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await gh(`/repos/${REPO}/pulls/${PR_NUMBER}/files?per_page=100&page=${page}`);
    files.push(...batch.map((f) => f.filename));
    if (batch.length < 100) return { files, truncated: false };
  }
  return { files, truncated: true };
}

async function latestCheckRuns() {
  const runs = new Map();
  for (let page = 1; page <= 10; page++) {
    const data = await gh(
      `/repos/${REPO}/commits/${HEAD_SHA}/check-runs?per_page=100&page=${page}&filter=latest`,
    );
    const batch = data.check_runs ?? [];
    for (const run of batch) {
      if (run.name === GATE_CONTEXT) continue; // never observe ourselves
      const prev = runs.get(run.name);
      if (!prev || String(run.started_at ?? "") >= String(prev.started_at ?? "")) {
        runs.set(run.name, run);
      }
    }
    if (batch.length < 100) break;
  }
  return runs;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { files, truncated } = await changedFiles();

console.log(`PR #${PR_NUMBER} head ${HEAD_SHA}`);
console.log(`changed files: ${files.length}${truncated ? " (TRUNCATED — failing safe)" : ""}`);

const { expected, notApplicable } = computeApplicability(files, truncated);

console.log(`\nAPPLICABLE (${expected.length}):`);
for (const c of expected) console.log(`  - ${c}`);
console.log(`NOT APPLICABLE (${notApplicable.length}) — paths untouched, never waited on:`);
for (const c of notApplicable) console.log(`  - ${c}`);

if (expected.length === 0) {
  fail("no applicable gates computed — the always-on gates should make this impossible");
}

const deadline = Date.now() + WAIT_BUDGET_MS;
let runs = new Map();

for (;;) {
  runs = await latestCheckRuns();
  const pending = pendingContexts(expected, runs);
  if (pending.length === 0) break;

  if (Date.now() >= deadline) {
    console.error(`\nStill not completed after ${Math.round(WAIT_BUDGET_MS / 60000)} minutes:`);
    for (const c of pending) {
      const run = runs.get(c);
      console.error(`  - ${c}: ${run ? `status=${run.status}` : "NEVER REPORTED"}`);
    }
    fail(
      `${pending.length} applicable gate(s) did not report: ${pending.join(", ")}. ` +
        "A workflow that never started is a failure, not a pass.",
    );
  }

  console.log(
    `\nwaiting on ${pending.length}: ${pending.join(", ")} ` +
      `(${Math.round((deadline - Date.now()) / 1000)}s budget left)`,
  );
  await sleep(POLL_INTERVAL_MS);
}

console.log("\nRESULTS");
const { results, failures } = evaluate(expected, runs);
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.context}  -> ${r.conclusion}`);
}

if (failures.length > 0) {
  fail(
    `${failures.length} applicable gate(s) did not succeed: ` +
      failures.map((f) => `${f.context} (${f.conclusion})`).join(", "),
  );
}

console.log(`\nAll ${expected.length} applicable gate(s) succeeded.`);
