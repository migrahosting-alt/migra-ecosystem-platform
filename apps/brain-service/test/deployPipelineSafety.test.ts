// The deploy pipeline's SAFETY PROPERTIES, pinned.
//
// 🚨 A DEPLOY PIPELINE IS PRODUCTION CODE. It can take the service down faster and
// more completely than any single commit, and its guards are the easiest thing in
// the repository to remove by accident — a one-line edit to a YAML condition is
// invisible in review and has no compiler, no type, and no test behind it.
//
// So each guard is asserted here for what it PREVENTS, not for how it is spelled.
// If one of these fails, do not "fix the test": work out which protection was
// dropped and why.
//
// Assertions are made against the workflow TEXT rather than a parsed tree, so this
// needs no YAML dependency the service does not otherwise have — a test that drags
// in a transitive package it never declared is a test that breaks on an unrelated
// install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

function repoRoot(): string {
  let dir = process.cwd(); // never __dirname: this package is ESM
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repository root not found from ' + process.cwd());
}

const ROOT = repoRoot();
const WORKFLOW = path.join(ROOT, '.github/workflows/deploy-brain.yml');
const RELEASE_SCRIPT = path.join(ROOT, 'scripts/brain-release.sh');
const PAYLOAD_SCRIPT = path.join(ROOT, 'scripts/build-brain-payload.sh');

const workflow = (): string => readFileSync(WORKFLOW, 'utf8');

test('the deploy workflow exists at all', () => {
  // Guards the rest: every assertion below would pass vacuously against a file
  // that had been renamed or deleted.
  assert.ok(existsSync(WORKFLOW), 'deploy-brain.yml is missing');
  assert.ok(workflow().length > 1000, 'workflow is suspiciously small');
});

test('a FAILED gate can never deploy', () => {
  assert.match(
    workflow(),
    /workflow_run\.conclusion == 'success'/,
    'the job must require the gate to have SUCCEEDED, or a red build ships',
  );
});

test('deploys come from an explicit ref, not from any branch that happens to be green', () => {
  // The team shares one working branch and lanes land continuously. Deploying
  // "whatever is green" ships another lane's half-built feature the moment it
  // compiles — which was live on this branch on the day the pipeline was written.
  assert.match(
    workflow(),
    /workflow_run\.head_branch == 'deploy\/brain'/,
    'the deploy ref gate is gone — any green branch could now reach production',
  );
});

test('the commit DEPLOYED is the commit that was TESTED', () => {
  // A branch can move between the gate finishing and this job starting. Checking
  // out the branch tip would ship a commit nothing ever tested.
  const w = workflow();
  assert.match(w, /workflow_run\.head_sha/, 'must resolve the tested sha');
  assert.match(w, /ref:\s*\$\{\{\s*steps\.target\.outputs\.sha\s*\}\}/, 'checkout must use that sha');
  assert.ok(
    !/ref:\s*['"]?(main|auth\/|deploy\/brain)['"]?\s*$/m.test(w),
    'checkout must not resolve a branch name',
  );
});

test('two deploys cannot race, and one in flight is never cancelled', () => {
  const w = workflow();
  assert.match(w, /concurrency:/, 'concurrent releases would interleave symlink moves');
  assert.match(
    w,
    /cancel-in-progress:\s*false/,
    'a cancelled release can leave `current` pointing at a half-copied tree',
  );
});

test('the release goes through the hardened script, which boot-tests and rolls back', () => {
  const w = workflow();
  assert.match(w, /brain-release\.sh/, 'must not hand-roll the release steps');
  assert.match(w, /--activate/, 'without --activate the release installs but never goes live');
  assert.ok(existsSync(RELEASE_SCRIPT), 'the release script referenced by the pipeline is missing');
  const script = readFileSync(RELEASE_SCRIPT, 'utf8');
  assert.match(script, /boot-test/i, 'the release script must boot-test before activating');
  assert.match(script, /ROLLING BACK|rolling back/i, 'the release script must roll back on an unhealthy activation');
});

test('the payload is built by the shared builder, not an inline tar that can drift', () => {
  const w = workflow();
  assert.match(w, /scripts\/build-brain-payload\.sh/, 'payload definition must be shared with humans');
  assert.ok(!/tar -czf/.test(w), 'an inline tar here would drift from the hand-deploy path');
  assert.ok(existsSync(PAYLOAD_SCRIPT), 'the payload builder is missing');
  const payload = readFileSync(PAYLOAD_SCRIPT, 'utf8');
  assert.match(payload, /server\.js/, 'the builder must verify the entry point is inside the payload');
});

test('there is a kill switch that works from the box itself', () => {
  // Stopping a bad deploy must not require a commit, a GitHub login, or waiting
  // for anyone with access.
  assert.match(
    workflow(),
    /\/etc\/migrapilot\/deploy\.disabled/,
    'no on-host kill switch: a runaway pipeline could only be stopped through GitHub',
  );
});

test('the tests are re-run on the machine that will run the code', () => {
  // The gate proves it on a hosted runner. That is a different OS image, a
  // different Node build and a different filesystem from VM111.
  assert.match(workflow(), /dist\/test\/\*\.test\.js/, 'the brain suite must re-run on the deployment host');
});

test('a deploy that leaves the service unhealthy fails loudly', () => {
  const w = workflow();
  assert.match(w, /\/health/, 'must verify the service after activating');
  assert.match(w, /status !== "ok"/, 'must FAIL on an unhealthy service, not merely print its status');
});

test('every script the pipeline runs is TRACKED, not merely present on someone disk', () => {
  /*
   * 🚨 THIS EXACT TRAP HAS BEEN SPRUNG BEFORE, and the repository's own .gitignore
   * records it: "the consumer script was written, deployed twice, and committed —
   * except git had quietly dropped it, and the commit shipped only the docs."
   *
   * The root .gitignore is an allowlist (`*`, then explicit negations), so a NEW
   * release script is invisible until it is named there. It runs perfectly on the
   * machine that wrote it and does not exist on the runner. `existsSync` above
   * cannot see the difference; only git can.
   */
  const scripts = [
    'scripts/brain-release.sh',
    'scripts/build-brain-payload.sh',
    'scripts/install-brain-deploy-runner.sh',
  ];
  const tracked = new Set(
    execFileSync('git', ['ls-files', '--', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean),
  );
  const missing = scripts.filter((s) => !tracked.has(s));
  assert.deepEqual(
    missing,
    [],
    'the pipeline runs these, but a clean checkout will not have them:\n  '
      + missing.join('\n  ')
      + '\nAdd an explicit `!/scripts/<name>` to .gitignore — never `git add -f`, which hides the cause.',
  );
});
